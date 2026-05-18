<script lang="ts">
	import { v4 as uuidv4 } from 'uuid';

	import { getContext, onMount, tick, onDestroy } from 'svelte';
	import { copyToClipboard } from '$lib/utils';

	import CodeEditor from '$lib/components/common/CodeEditor.svelte';
	import SvgPanZoom from '$lib/components/common/SVGPanZoom.svelte';
	import {
		Check,
		ChevronsUpDown,
		Copy,
		LoaderCircle,
		PanelRightOpen,
		Play,
		Save
	} from 'lucide-svelte';
	import {
		artifactAutoOpenDismissedMessageId,
		artifactPreviewTarget,
		config,
		settings,
		showArtifacts,
		showControls,
		showOverview
	} from '$lib/stores';
	import { executeCode } from '$lib/apis/utils';
	import { toast } from 'svelte-sonner';
	import {
		approvePyodideConsent,
		canUsePyodideRuntime,
		getPyodideDownloadSummary,
		getPyodidePackagesForCode,
		hasPyodideConsent,
		usesRemotePyodideRuntime
	} from '$lib/utils/browser-ai-assets';
	import { getLanguageIcon } from '$lib/utils/language-icons';
	import {
		DEFAULT_MERMAID_THEME,
		normalizeMermaidTheme,
		renderMermaidSvg
	} from '$lib/utils/lobehub-chat-appearance';

	const i18n = getContext('i18n');

	export let id = '';

	export let onSave = (e) => {};
	export let onCode = (e) => {};

	export let save = false;
	export let run = true;
	export let collapsed = false;

	export let token;
	export let lang = '';
	export let code = '';
	export let messageId = '';

	$: langIcon = getLanguageIcon(lang);
	export let attributes = {};

	export let className = 'my-2';
	export let editorClassName = '';

	let pyodideWorker = null;

	let _code = '';
	$: if (code) {
		updateCode();
	}

	const updateCode = () => {
		_code = code;
	};

	let _token = null;
	let mermaidThemeId = DEFAULT_MERMAID_THEME;

	let mermaidHtml = null;
	let executing = false;

	let stdout = null;
	let stderr = null;
	let result = null;
	let files = null;

	let copied = false;
	let saved = false;
	let mermaidThemeObserver: MutationObserver | null = null;
	let heightObserver: ResizeObserver | null = null;
	const PYODIDE_DISABLED_MESSAGE = 'Pyodide is disabled in this build.';
	let showPyodideConsent = false;
	let pendingPyodideCode = '';
	let pyodideConsentPackages: string[] = [];

	const MAX_COLLAPSED_HEIGHT = 350;
	let codeWrapperEl: HTMLDivElement = null as unknown as HTMLDivElement;
	let codeNaturalHeight = collapsed ? MAX_COLLAPSED_HEIGHT + 1 : 0;
	$: needsCollapse = codeNaturalHeight > MAX_COLLAPSED_HEIGHT;

	const collapseCodeBlock = () => {
		collapsed = !collapsed;
	};

	const isSvgPreviewable = (lang: string, code: string) => {
		const normalizedLang = String(lang ?? '').toLowerCase();
		return normalizedLang === 'svg' || (normalizedLang === 'xml' && code.includes('<svg'));
	};

	const isIframePreviewable = (lang: string) => {
		const normalizedLang = String(lang ?? '').toLowerCase();
		return ['html', 'css', 'javascript', 'js'].includes(normalizedLang);
	};

	const openIframePreview = () => {
		if (!messageId) return;

		artifactAutoOpenDismissedMessageId.set(null);
		artifactPreviewTarget.set({
			messageId,
			type: 'iframe'
		});
		showOverview.set(false);
		showArtifacts.set(true);
		showControls.set(true);
	};

	const previewSvg = () => {
		const previewContent = (_code || code || '').trim();
		if (!previewContent) return;

		artifactAutoOpenDismissedMessageId.set(null);
		artifactPreviewTarget.set({
			messageId,
			type: 'svg',
			content: previewContent
		});
		showOverview.set(false);
		showArtifacts.set(true);
		showControls.set(true);
	};

	const saveCode = () => {
		saved = true;

		code = _code;
		onSave(code);

		setTimeout(() => {
			saved = false;
		}, 1000);
	};

	const copyCode = async () => {
		copied = true;
		await copyToClipboard(code);

		setTimeout(() => {
			copied = false;
		}, 1000);
	};

	const checkPythonCode = (str) => {
		// Check if the string contains typical Python syntax characters
		const pythonSyntax = [
			'def ',
			'else:',
			'elif ',
			'try:',
			'except:',
			'finally:',
			'yield ',
			'lambda ',
			'assert ',
			'nonlocal ',
			'del ',
			'True',
			'False',
			'None',
			' and ',
			' or ',
			' not ',
			' in ',
			' is ',
			' with '
		];

		for (let syntax of pythonSyntax) {
			if (str.includes(syntax)) {
				return true;
			}
		}

		// If none of the above conditions met, it's probably not Python code
		return false;
	};

	const executePython = async (code) => {
		result = null;
		stdout = null;
		stderr = null;

		executing = true;

		if ($config?.code?.engine === 'jupyter') {
			const output = await executeCode(localStorage.token, code).catch((error) => {
				toast.error(`${error}`);
				return null;
			});

			if (output) {
				if (output['stdout']) {
					stdout = output['stdout'];
					const stdoutLines = stdout.split('\n');

					for (const [idx, line] of stdoutLines.entries()) {
						if (line.startsWith('data:image/png;base64')) {
							if (files) {
								files.push({
									type: 'image/png',
									data: line
								});
							} else {
								files = [
									{
										type: 'image/png',
										data: line
									}
								];
							}

							if (stdout.startsWith(`${line}\n`)) {
								stdout = stdout.replace(`${line}\n`, ``);
							} else if (stdout.startsWith(`${line}`)) {
								stdout = stdout.replace(`${line}`, ``);
							}
						}
					}
				}

				if (output['result']) {
					result = output['result'];
					const resultLines = result.split('\n');

					for (const [idx, line] of resultLines.entries()) {
						if (line.startsWith('data:image/png;base64')) {
							if (files) {
								files.push({
									type: 'image/png',
									data: line
								});
							} else {
								files = [
									{
										type: 'image/png',
										data: line
									}
								];
							}

							if (result.startsWith(`${line}\n`)) {
								result = result.replace(`${line}\n`, ``);
							} else if (result.startsWith(`${line}`)) {
								result = result.replace(`${line}`, ``);
							}
						}
					}
				}

				output['stderr'] && (stderr = output['stderr']);
			}

			executing = false;
		} else {
			executePythonAsWorker(code);
		}
	};

	const executePythonAsWorker = async (code) => {
		if (!canUsePyodideRuntime()) {
			stderr = PYODIDE_DISABLED_MESSAGE;
			executing = false;
			return;
		}

		const packages = getPyodidePackagesForCode(code);

		if (usesRemotePyodideRuntime() && !hasPyodideConsent()) {
			pendingPyodideCode = code;
			pyodideConsentPackages = packages;
			showPyodideConsent = true;
			executing = false;
			return;
		}

		const { default: PyodideWorker } = await import('$lib/workers/pyodide.worker?worker');
		pyodideWorker = new PyodideWorker();

		pyodideWorker.postMessage({
			id: id,
			code: code,
			packages: packages
		});

		const executionTimeout = setTimeout(() => {
			if (executing) {
				executing = false;
				stderr = 'Execution Time Limit Exceeded';
				pyodideWorker.terminate();
			}
		}, 60000);

		pyodideWorker.onmessage = (event) => {
			const { id, ...data } = event.data;
			clearTimeout(executionTimeout);

			if (data['stdout']) {
				stdout = data['stdout'];
				const stdoutLines = stdout.split('\n');

				for (const [idx, line] of stdoutLines.entries()) {
					if (line.startsWith('data:image/png;base64')) {
						if (files) {
							files.push({
								type: 'image/png',
								data: line
							});
						} else {
							files = [
								{
									type: 'image/png',
									data: line
								}
							];
						}

						if (stdout.startsWith(`${line}\n`)) {
							stdout = stdout.replace(`${line}\n`, ``);
						} else if (stdout.startsWith(`${line}`)) {
							stdout = stdout.replace(`${line}`, ``);
						}
					}
				}
			}

			if (data['result']) {
				result = data['result'];
				const resultLines = result.split('\n');

				for (const [idx, line] of resultLines.entries()) {
					if (line.startsWith('data:image/png;base64')) {
						if (files) {
							files.push({
								type: 'image/png',
								data: line
							});
						} else {
							files = [
								{
									type: 'image/png',
									data: line
								}
							];
						}

						if (result.startsWith(`${line}\n`)) {
							result = result.replace(`${line}\n`, ``);
						} else if (result.startsWith(`${line}`)) {
							result = result.replace(`${line}`, ``);
						}
					}
				}
			}

			data['stderr'] && (stderr = data['stderr']);
			data['result'] && (result = data['result']);

			executing = false;
			pyodideWorker.terminate();
		};

		pyodideWorker.onerror = () => {
			clearTimeout(executionTimeout);
			executing = false;
			pyodideWorker.terminate();
		};
	};

	const drawMermaidDiagram = async () => {
		if (typeof document === 'undefined') return;

		try {
			mermaidHtml = await renderMermaidSvg({
				code,
				id: `mermaid-${uuidv4()}`,
				isDark: document.documentElement.classList.contains('dark'),
				themeId: mermaidThemeId
			});
			} catch (error) {
				console.error('Error:', error);
				mermaidHtml = null;
			}
		};

	const render = async () => {
		if (lang === 'mermaid' && (token?.raw ?? '').slice(-4).includes('```')) {
			(async () => {
				await drawMermaidDiagram();
			})();
		}
	};

	$: if (token) {
		if (JSON.stringify(token) !== JSON.stringify(_token)) {
			_token = token;
		}
	}

	$: if (_token) {
		mermaidThemeId = normalizeMermaidTheme($settings?.mermaidTheme ?? DEFAULT_MERMAID_THEME);
		render();
	}

	$: onCode({ lang, code });

	$: if (attributes) {
		onAttributesUpdate();
	}

	const onAttributesUpdate = () => {
		if (attributes?.output) {
			// Create a helper function to unescape HTML entities
			const unescapeHtml = (html) => {
				const textArea = document.createElement('textarea');
				textArea.innerHTML = html;
				return textArea.value;
			};

			try {
				// Unescape the HTML-encoded string
				const unescapedOutput = unescapeHtml(attributes.output);

				// Parse the unescaped string into JSON
				const output = JSON.parse(unescapedOutput);

				// Assign the parsed values to variables
				stdout = output.stdout;
				stderr = output.stderr;
				result = output.result;
			} catch (error) {
				console.error('Error:', error);
			}
		}
	};

	onMount(async () => {
		if (lang) {
			onCode({ lang, code });
		}

		mermaidThemeObserver = new MutationObserver(() => {
			if (lang === 'mermaid') {
				render();
			}
		});

		mermaidThemeObserver.observe(document.documentElement, {
			attributeFilter: ['class'],
			attributes: true
		});

		await tick();
		if (codeWrapperEl) {
			heightObserver = new ResizeObserver(() => {
				if (codeWrapperEl) {
					codeNaturalHeight = codeWrapperEl.scrollHeight;
				}
			});
			heightObserver.observe(codeWrapperEl);
		}
	});

	onDestroy(() => {
		mermaidThemeObserver?.disconnect();
		heightObserver?.disconnect();
		if (pyodideWorker) {
			pyodideWorker.terminate();
		}
	});
</script>

<div>
	<div
		class="relative {className} group/codeblock flex flex-col rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 my-2 overflow-hidden"
		dir="ltr"
	>
		{#if lang === 'mermaid'}
			{#if mermaidHtml}
				<SvgPanZoom
					className=" border border-gray-100 dark:border-gray-850 rounded-lg max-h-fit overflow-hidden"
					svg={mermaidHtml}
					content={_token.text}
				/>
			{:else}
				<pre class="mermaid">{code}</pre>
			{/if}
		{:else}
			<div
				class="sticky top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-1.5 min-h-[36px] bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 cursor-pointer"
				on:click={collapseCodeBlock}
			>
				<div class="flex items-center gap-2">
					<span class="size-4 flex-shrink-0" aria-hidden="true">
						{@html langIcon.svg}
					</span>
					<span class="text-[13px] font-medium text-gray-600 dark:text-gray-400">
						{langIcon.label}
					</span>
				</div>
				<div class="flex items-center gap-1" on:click|stopPropagation>
					{#if ($config?.features?.enable_code_execution ?? true) && (lang.toLowerCase() === 'python' || lang.toLowerCase() === 'py' || (lang === '' && checkPythonCode(code)))}
						{#if executing}
							<div
								class="inline-flex items-center text-gray-400 dark:text-gray-500 p-1.5 rounded-md"
								title={$i18n.t('Running')}
							>
								<LoaderCircle class="size-4 animate-spin" size={16} strokeWidth={2.1} />
							</div>
						{:else if run}
							<button
								class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
								on:click={async () => {
									code = _code;
									await tick();
									executePython(code);
								}}
								title={$i18n.t('Run')}
							>
								<Play class="size-4" size={16} strokeWidth={2.1} />
							</button>
						{/if}
					{/if}

					{#if messageId && isIframePreviewable(lang)}
						<button
							class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-sky-600 dark:hover:text-sky-400 p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
							on:click={openIframePreview}
							title={$i18n.t('Open preview')}
						>
							<PanelRightOpen class="size-[17.5px]" size={17.5} strokeWidth={1.8} />
						</button>
					{/if}

					{#if isSvgPreviewable(lang, code)}
						<button
							class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-sky-600 dark:hover:text-sky-400 p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
							on:click={previewSvg}
							title={`${$i18n.t('Preview')} SVG`}
						>
							<PanelRightOpen class="size-[17.5px]" size={17.5} strokeWidth={1.8} />
						</button>
					{/if}

					{#if save}
						<button
							class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
							on:click={saveCode}
							title={$i18n.t('Save')}
						>
							{#if saved}
									<Check class="size-[17.5px] text-green-500" size={17.5} strokeWidth={2.15} />
								{:else}
									<Save class="size-[17.5px]" size={17.5} strokeWidth={1.95} />
								{/if}
						</button>
					{/if}

					<button
						class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
						on:click={copyCode}
						title={$i18n.t('Copy')}
					>
						{#if copied}
							<Check class="size-4 text-green-500" size={16} strokeWidth={2.3} />
						{:else}
							<Copy class="size-4" size={16} strokeWidth={2.1} />
						{/if}
					</button>

					<button
						class="inline-flex items-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition"
						on:click={collapseCodeBlock}
						title={collapsed ? $i18n.t('Expand') : $i18n.t('Collapse')}
					>
						<ChevronsUpDown class="size-4" size={16} strokeWidth={2.1} />
					</button>
				</div>
			</div>

			{#if showPyodideConsent}
				<div class="border-b border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
					<div class="font-medium">
						{$i18n.t('浏览器 Python 运行时未准备就绪', {
							defaultValue: 'Browser Python runtime is not ready'
						})}
					</div>
					<div class="mt-1 text-xs leading-relaxed">
						{getPyodideDownloadSummary(pyodideConsentPackages)}
					</div>
					<div class="mt-3 flex gap-2">
						<button
							class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700"
							on:click={async () => {
								approvePyodideConsent();
								showPyodideConsent = false;
								const nextCode = pendingPyodideCode || code;
								pendingPyodideCode = '';
								pyodideConsentPackages = [];
								executing = true;
								await executePythonAsWorker(nextCode);
							}}
							type="button"
						>
							{$i18n.t('下载并启用', { defaultValue: 'Download and Enable' })}
						</button>
						<button
							class="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30"
							on:click={() => {
								showPyodideConsent = false;
								pendingPyodideCode = '';
								pyodideConsentPackages = [];
								stderr = $i18n.t('已取消下载浏览器 Python 运行时。', {
									defaultValue: 'Browser Python runtime download was cancelled.'
								});
							}}
							type="button"
						>
							{$i18n.t('暂不', { defaultValue: 'Not now' })}
						</button>
					</div>
				</div>
			{/if}

			<div
				bind:this={codeWrapperEl}
				class="language-{lang} {editorClassName
					? editorClassName
					: executing || stdout || stderr || result
						? ''
						: ''} font-mono"
				style={collapsed && needsCollapse ? `max-height: ${MAX_COLLAPSED_HEIGHT}px; overflow-y: auto;` : ''}
			>
				<CodeEditor
					value={code}
					{id}
					{lang}
					onSave={() => {
						saveCode();
					}}
					onChange={(value) => {
						_code = value;
					}}
				/>
			</div>

			{#if needsCollapse}
				<button
					class="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 border-t border-gray-200 dark:border-gray-800 transition-colors"
					on:click={collapseCodeBlock}
				>
					{#if collapsed}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5">
							<path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
						</svg>
							{$i18n.t('Expand')} ({code.split('\n').length})
					{:else}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5">
							<path fill-rule="evenodd" d="M14.78 11.78a.75.75 0 0 1-1.06 0L10 8.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06Z" clip-rule="evenodd" />
						</svg>
						{$i18n.t('Collapse')}
					{/if}
				</button>
			{/if}

			{#if !collapsed}
				<div
					id="plt-canvas-{id}"
					class="bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 max-w-full overflow-x-auto scrollbar-hidden"
				></div>

				{#if executing || stdout || stderr || result || files}
					<div
						class="bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-200 border-t border-gray-100 dark:border-gray-800/50 py-3 px-4 flex flex-col gap-3"
					>
						{#if executing}
							<div>
								<div
									class="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 mb-2"
								>
									{$i18n.t('Output')}
								</div>
								<div class="text-sm flex items-center gap-2 text-gray-500">
									<svg
										class="animate-spin size-3.5"
										xmlns="http://www.w3.org/2000/svg"
										fill="none"
										viewBox="0 0 24 24"
									>
										<circle
											class="opacity-25"
											cx="12"
											cy="12"
											r="10"
											stroke="currentColor"
											stroke-width="4"
										></circle>
										<path
											class="opacity-75"
											fill="currentColor"
											d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
										></path>
									</svg>
									{$i18n.t('Running...')}
								</div>
							</div>
						{:else}
							{#if stdout || stderr}
								<div>
									<div
										class="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 mb-2"
									>
										{$i18n.t('Output')}
									</div>
									<div
										class="text-sm leading-6 font-mono whitespace-pre-wrap bg-white dark:bg-gray-950 rounded-lg p-3 border border-gray-100 dark:border-gray-800 {stdout?.split(
											'\n'
										)?.length > 100
											? `max-h-96`
											: ''} overflow-y-auto"
										style="font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;"
									>
										{stdout || stderr}
									</div>
								</div>
							{/if}
							{#if result || files}
								<div>
									<div
										class="inline-flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800/50 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 mb-2"
									>
										{$i18n.t('Result')}
									</div>
									{#if result}
										<div
											class="text-sm leading-6 font-mono bg-white dark:bg-gray-950 rounded-lg p-3 border border-gray-100 dark:border-gray-800"
											style="font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;"
										>
											{`${JSON.stringify(result)}`}
										</div>
									{/if}
									{#if files}
										<div class="flex flex-col gap-2 mt-2">
											{#each files as file}
												{#if file.type.startsWith('image')}
													<img
														src={file.data}
														alt="Output"
														class="w-full max-w-[36rem] rounded-lg border border-gray-100 dark:border-gray-800"
													/>
												{/if}
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			{/if}
		{/if}
	</div>
</div>
