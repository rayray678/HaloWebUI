<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { DropdownMenu } from 'bits-ui';
	import { getContext, onMount } from 'svelte';
	import {
		createNewSkill,
		deleteSkillById,
		getSkillById,
		getSkills,
		importSkillFromGithub,
		importSkillFromRemoteZipUrl,
		importSkillFromUrl,
		importSkillFromZip,
		updateSkillById,
		type SkillImportStatus,
		type SkillModel
	} from '$lib/apis/skills';
	import {
		VERIFIED_LOBEHUB_SKILLS,
		getVerifiedLobeHubSkillByIdentifier,
		isVerifiedLobeHubSkillIdentifier,
		type CuratedLobeHubSkill,
		type CuratedLobeHubSkillIcon
	} from '$lib/config/skill-catalog';
	import { WEBUI_NAME, skills as skillsStore, user } from '$lib/stores';
	import { flyAndScale } from '$lib/utils/transitions';

	import Modal from '../common/Modal.svelte';
	import Dropdown from '../common/Dropdown.svelte';
	import ConfirmDialog from '../common/ConfirmDialog.svelte';
	import Spinner from '../common/Spinner.svelte';
	import AccessControlModal from './common/AccessControlModal.svelte';

	import Search from '../icons/Search.svelte';
	import Plus from '../icons/Plus.svelte';
	import Sparkles from '../icons/Sparkles.svelte';
	import Link from '../icons/Link.svelte';
	import CloudArrowUp from '../icons/CloudArrowUp.svelte';
	import DocumentArrowUpSolid from '../icons/DocumentArrowUpSolid.svelte';
	import ArrowPath from '../icons/ArrowPath.svelte';
	import Pencil from '../icons/Pencil.svelte';
	import GarbageBin from '../icons/GarbageBin.svelte';
	import LockClosed from '../icons/LockClosed.svelte';
	import XMark from '../icons/XMark.svelte';
	import BookOpen from '../icons/BookOpen.svelte';
	import CommandLine from '../icons/CommandLine.svelte';
	import Document from '../icons/Document.svelte';
	import DocumentDuplicate from '../icons/DocumentDuplicate.svelte';
	import ChatBubbleOvalEllipsis from '../icons/ChatBubbleOvalEllipsis.svelte';
	import GlobeAlt from '../icons/GlobeAlt.svelte';

	const i18n = getContext('i18n');

	type StoreTab = 'lobehub' | 'community' | 'custom';
	type ImportType = 'url' | 'github';
	type SkillSourceKind = 'lobehub' | 'community' | 'custom';

	const STORE_TABS: StoreTab[] = ['lobehub', 'community', 'custom'];
	const DEFAULT_SKILL_ICON = Sparkles;
	const IMPORTED_SKILL_ICON = DocumentArrowUpSolid;
	const CATALOG_ICON_MAP: Record<CuratedLobeHubSkillIcon, any> = {
		document: Document,
		'document-duplicate': DocumentDuplicate,
		globe: GlobeAlt,
		'book-open': BookOpen,
		'chat-bubble': ChatBubbleOvalEllipsis,
		'command-line': CommandLine
	};

	let loaded = false;
	let refreshing = false;
	let showStore = false;
	let showAddMenu = false;
	let showEditor = false;
	let showDeleteConfirm = false;
	let showAccessControlModal = false;
	let showImportModal = false;
	let importLoading = false;
	let installingCatalogSkillId: string | null = null;
	let storeTab: StoreTab = 'lobehub';
	let importType: ImportType = 'url';
	let mainQuery = '';
	let storeQuery = '';
	let importValue = '';
	let zipInputElement: HTMLInputElement | null = null;

	let promptSkills: SkillModel[] = [];

	let editingSkill: SkillModel | null = null;
	let deletingSkill: SkillModel | null = null;
	let accessControl: Record<string, any> | null = null;
	$: canManageAcl = !editingSkill || $user?.role === 'admin' || editingSkill.user_id === $user?.id;
	let skillForm = {
		name: '',
		description: '',
		content: '',
		tags: ''
	};

	const cloneJson = <T>(value: T): T => {
		if (value === null || value === undefined) {
			return value;
		}

		return JSON.parse(JSON.stringify(value));
	};

	const normalizeQuery = (value: string) => value.trim().toLowerCase();

	const createPrivateAccessControl = () => ({
		read: {
			group_ids: [],
			user_ids: []
		},
		write: {
			group_ids: [],
			user_ids: []
		}
	});

	const getDefaultAccessControl = () =>
		$user?.role === 'admin' ? null : createPrivateAccessControl();

	const formatError = (error: unknown) => {
		let message = '';

		if (typeof error === 'string') {
			message = error;
		} else if (error && typeof error === 'object' && 'message' in error) {
			message = String((error as { message: string }).message);
		} else {
			message = `${error}`;
		}

		if (message === "We could not find what you're looking for :/") {
			return $i18n.t(
				'Skills API endpoint not found. The backend may need to restart or apply the latest changes.'
			);
		}

		const skillMdFetchStatus = message.match(/^Failed to fetch SKILL\.md \((\d+)\)\.$/);
		if (skillMdFetchStatus) {
			return $i18n.t('Failed to fetch SKILL.md ({{status}}).', {
				status: skillMdFetchStatus[1]
			});
		}

		const skillMdFetchError = message.match(/^Failed to fetch SKILL\.md: (.+)$/);
		if (skillMdFetchError) {
			return $i18n.t('Failed to fetch SKILL.md: {{error}}', {
				error: skillMdFetchError[1]
			});
		}

		const zipFetchStatus = message.match(/^Failed to fetch ZIP package \((\d+)\)\.$/);
		if (zipFetchStatus) {
			return $i18n.t('Failed to fetch ZIP package ({{status}}).', {
				status: zipFetchStatus[1]
			});
		}

		const zipFetchError = message.match(/^Failed to fetch ZIP package: (.+)$/);
		if (zipFetchError) {
			return $i18n.t('Failed to fetch ZIP package: {{error}}', {
				error: zipFetchError[1]
			});
		}

		const githubInspectStatus = message.match(/^Failed to inspect GitHub repository \((\d+)\)\.$/);
		if (githubInspectStatus) {
			return $i18n.t('Failed to inspect GitHub repository ({{status}}).', {
				status: githubInspectStatus[1]
			});
		}

		const githubInspectError = message.match(/^Failed to inspect GitHub repository: (.+)$/);
		if (githubInspectError) {
			return $i18n.t('Failed to inspect GitHub repository: {{error}}', {
				error: githubInspectError[1]
			});
		}

		const invalidFrontmatter = message.match(/^Invalid SKILL\.md frontmatter: (.+)$/);
		if (invalidFrontmatter) {
			return $i18n.t('Invalid SKILL.md frontmatter: {{error}}', {
				error: invalidFrontmatter[1]
			});
		}

		if (message && message !== 'undefined') {
			return $i18n.t(message);
		}

		return $i18n.t('Please try again later.');
	};

	const getCatalogEntryByIdentifier = (identifier?: string | null) =>
		getVerifiedLobeHubSkillByIdentifier(identifier);

	const getInstalledCatalogSkill = (entry: CuratedLobeHubSkill) =>
		promptSkills.find((skill) => skill.identifier === entry.identifier) ?? null;

	const getSkillSource = (skill: SkillModel): SkillSourceKind => {
		if (isVerifiedLobeHubSkillIdentifier(skill.identifier)) {
			return 'lobehub';
		}

		return (skill.source || 'manual') !== 'manual' ? 'community' : 'custom';
	};

	const getSkillSourceBadge = (skill: SkillModel) => {
		const source = getSkillSource(skill);
		if (source === 'lobehub') return 'LobeHub';
		if (skill.source === 'github') return 'GitHub';
		if (skill.source === 'url') return 'URL';
		if (skill.source === 'zip') return 'ZIP';
		if (source === 'community') return $i18n.t('Community');
		return $i18n.t('Custom');
	};

	const getSkillSourceBadgeClass = (skill: SkillModel) => {
		const source = getSkillSource(skill);
		if (source === 'lobehub') {
			return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
		}

		if (source === 'community') {
			return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
		}

		return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
	};

	const getSkillTags = (skill: SkillModel) =>
		Array.isArray(skill.meta?.tags) ? skill.meta.tags.filter(Boolean) : [];

	const getSkillPackageFileCount = (skill: SkillModel) =>
		Array.isArray(skill.meta?.package_files) ? skill.meta.package_files.length : 0;

	const getSkillSourceUrl = (skill: SkillModel) => {
		const catalogEntry = getCatalogEntryByIdentifier(skill.identifier);
		if (catalogEntry) return catalogEntry.skillUrl;

		return typeof skill.source_url === 'string'
			? skill.source_url
			: typeof skill.meta?.source_url === 'string'
				? skill.meta.source_url
				: '';
	};

	const getImportSourceLabel = (source?: string | null) => {
		if (!source || source === 'manual') return $i18n.t('Custom');
		if (source === 'github') return 'GitHub';
		if (source === 'url') return 'URL';
		if (source === 'zip') return 'ZIP';
		return source;
	};

	const getCatalogCategoryLabel = (entry: CuratedLobeHubSkill) => $i18n.t(entry.category);

	const getSkillCategoryLabel = (skill: SkillModel) => {
		const catalogEntry = getCatalogEntryByIdentifier(skill.identifier);
		if (catalogEntry) return getCatalogCategoryLabel(catalogEntry);

		const manifestCategory = skill.meta?.manifest?.category;
		if (typeof manifestCategory === 'string' && manifestCategory.trim()) {
			return manifestCategory.replace(/[-_]/g, ' ');
		}

		return '';
	};

	const getSkillMetaLine = (skill: SkillModel) => {
		const source = getSkillSource(skill);
		if (source === 'lobehub') {
			return $i18n.t('Installed from verified LobeHub skill');
		}

		if (source === 'community') {
			return getSkillSourceUrl(skill) || skill.identifier || $i18n.t('Imported Skill');
		}

		return $i18n.t('Custom skill');
	};

	const getSkillIcon = (skill: SkillModel) => {
		const catalogEntry = getCatalogEntryByIdentifier(skill.identifier);
		if (catalogEntry) {
			return CATALOG_ICON_MAP[catalogEntry.icon];
		}

		return getSkillSource(skill) === 'community' ? IMPORTED_SKILL_ICON : DEFAULT_SKILL_ICON;
	};

	const getSkillIconAccent = (skill: SkillModel) => {
		const catalogEntry = getCatalogEntryByIdentifier(skill.identifier);
		if (catalogEntry) {
			return catalogEntry.accent;
		}

		return getSkillSource(skill) === 'community'
			? 'from-amber-300 via-orange-300 to-rose-300'
			: 'from-slate-400 via-slate-500 to-slate-600';
	};

	const matchesSkillQuery = (skill: SkillModel, query: string) => {
		const normalized = normalizeQuery(query);
		if (!normalized) return true;

		const haystack = [
			skill.name,
			skill.description,
			getSkillSourceBadge(skill),
			getSkillCategoryLabel(skill),
			getSkillMetaLine(skill),
			getSkillSourceUrl(skill),
			skill.identifier,
			...getSkillTags(skill)
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();

		return haystack.includes(normalized);
	};

	const matchesCatalogQuery = (entry: CuratedLobeHubSkill, query: string) => {
		const normalized = normalizeQuery(query);
		if (!normalized) return true;

		const haystack = [
			$i18n.t(entry.title),
			$i18n.t(entry.description),
			$i18n.t(entry.category),
			entry.identifier
		]
			.join(' ')
			.toLowerCase();

		return haystack.includes(normalized);
	};

	const getTabLabel = (tab: StoreTab) => {
		if (tab === 'lobehub') return 'LobeHub';
		if (tab === 'community') return $i18n.t('Community');
		return $i18n.t('Custom');
	};

	const getPromptSkillById = async (skillId: string) => {
		const existing = promptSkills.find((skill) => skill.id === skillId);
		if (existing) return existing;
		return await getSkillById(localStorage.token, skillId);
	};

	const loadPromptSkills = async () => {
		promptSkills = (await getSkills(localStorage.token)) ?? [];
		skillsStore.set(promptSkills);
	};

	const refreshData = async ({ silent = false }: { silent?: boolean } = {}) => {
		refreshing = true;

		try {
			await loadPromptSkills();
		} catch (error) {
			if (!silent) {
				toast.error(formatError(error));
			}
		} finally {
			refreshing = false;
			loaded = true;
		}
	};

	const openCreateSkillModal = () => {
		editingSkill = null;
		skillForm = { name: '', description: '', content: '', tags: '' };
		accessControl = getDefaultAccessControl();
		showAddMenu = false;
		showEditor = true;
	};

	const openEditSkillModal = async (skillId: string) => {
		try {
			const skill = await getPromptSkillById(skillId);

			editingSkill = skill;
			skillForm = {
				name: skill.name ?? '',
				description: skill.description ?? '',
				content: skill.content ?? '',
				tags: Array.isArray(skill.meta?.tags) ? skill.meta.tags.join(', ') : ''
			};
			accessControl = cloneJson(skill.access_control ?? null);
			showEditor = true;
		} catch (error) {
			toast.error(formatError(error));
		}
	};

	const saveSkill = async () => {
		const name = skillForm.name.trim();
		if (!name) {
			toast.error($i18n.t('Name is required'));
			return;
		}

		const tagsList = skillForm.tags
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);

		const nextMeta = cloneJson(editingSkill?.meta ?? {}) ?? {};
		if (tagsList.length > 0) {
			nextMeta.tags = tagsList;
		} else {
			delete nextMeta.tags;
		}

		const payload = {
			name,
			description: skillForm.description.trim(),
			content: skillForm.content,
			meta: Object.keys(nextMeta).length > 0 ? nextMeta : null,
			access_control: cloneJson(accessControl),
			is_active: editingSkill?.is_active ?? true
		};

		try {
			if (editingSkill) {
				await updateSkillById(localStorage.token, editingSkill.id, payload);
				toast.success($i18n.t('Skill updated'));
			} else {
				await createNewSkill(localStorage.token, payload);
				toast.success($i18n.t('Skill created'));
			}

			showEditor = false;
			await refreshData({ silent: true });
		} catch (error) {
			toast.error(formatError(error));
		}
	};

	const confirmDeleteSkill = async (skillId: string) => {
		try {
			deletingSkill = await getPromptSkillById(skillId);
			showDeleteConfirm = true;
		} catch (error) {
			toast.error(formatError(error));
		}
	};

	const handleDelete = async () => {
		if (!deletingSkill) return;

		try {
			await deleteSkillById(localStorage.token, deletingSkill.id);
			toast.success($i18n.t('Skill deleted'));
			showDeleteConfirm = false;
			deletingSkill = null;
			await refreshData({ silent: true });
		} catch (error) {
			toast.error(formatError(error));
		}
	};

	const openImportModal = (type: ImportType) => {
		importType = type;
		importValue = '';
		showImportModal = true;
		showAddMenu = false;
	};

	const formatImportMessage = (status: SkillImportStatus) => {
		if (status === 'created') return $i18n.t('Skill imported');
		if (status === 'updated') return $i18n.t('Skill updated from source');
		return $i18n.t('Skill is already up to date');
	};

	const installCatalogSkill = async (entry: CuratedLobeHubSkill) => {
		if (getInstalledCatalogSkill(entry)) {
			toast.success($i18n.t('Skill is already installed'));
			return;
		}

		installingCatalogSkillId = entry.id;

		try {
			const result = await importSkillFromRemoteZipUrl(
				localStorage.token,
				entry.downloadUrl,
				`${entry.identifier}.zip`
			);

			toast.success(formatImportMessage(result.status));
			await refreshData({ silent: true });
		} catch (error) {
			toast.error(formatError(error));
		} finally {
			installingCatalogSkillId = null;
		}
	};

	const handleImport = async () => {
		if (!importValue.trim()) {
			toast.error($i18n.t('URL is required'));
			return;
		}

		importLoading = true;

		try {
			const result =
				importType === 'github'
					? await importSkillFromGithub(localStorage.token, importValue.trim())
					: await importSkillFromUrl(localStorage.token, importValue.trim());

			toast.success(formatImportMessage(result.status));
			showImportModal = false;
			storeTab = 'community';
			await refreshData({ silent: true });
		} catch (error) {
			toast.error(formatError(error));
		} finally {
			importLoading = false;
		}
	};

	const handleZipSelection = async () => {
		const file = zipInputElement?.files?.[0];
		if (!file) return;

		try {
			const result = await importSkillFromZip(localStorage.token, file);
			toast.success(formatImportMessage(result.status));
			storeTab = 'community';
			await refreshData({ silent: true });
		} catch (error) {
			toast.error(formatError(error));
		} finally {
			if (zipInputElement) {
				zipInputElement.value = '';
			}
		}
	};

	const triggerZipImport = () => {
		showAddMenu = false;
		zipInputElement?.click();
	};

	$: installedSkills = [...promptSkills];
	$: filteredInstalledSkills = installedSkills.filter((skill) => matchesSkillQuery(skill, mainQuery));
	$: lobehubInstalledCount = installedSkills.filter((skill) => getSkillSource(skill) === 'lobehub').length;
	$: communityInstalledCount = installedSkills.filter((skill) => getSkillSource(skill) === 'community').length;
	$: customInstalledCount = installedSkills.filter((skill) => getSkillSource(skill) === 'custom').length;
	$: communityStoreSkills = installedSkills.filter((skill) => getSkillSource(skill) === 'community');
	$: customStoreSkills = installedSkills.filter((skill) => getSkillSource(skill) === 'custom');
	$: filteredLobeHubSkills = VERIFIED_LOBEHUB_SKILLS.filter((entry) =>
		matchesCatalogQuery(entry, storeQuery)
	);
	$: filteredCommunitySkills = communityStoreSkills.filter((skill) =>
		matchesSkillQuery(skill, storeQuery)
	);
	$: filteredCustomSkills = customStoreSkills.filter((skill) => matchesSkillQuery(skill, storeQuery));

	onMount(async () => {
		await refreshData();
	});
</script>

<svelte:head>
	<title>
		{$i18n.t('Skills')} | {$WEBUI_NAME}
	</title>
</svelte:head>

<input
	bind:this={zipInputElement}
	type="file"
	accept=".zip,application/zip"
	class="hidden"
	on:change={handleZipSelection}
/>

<ConfirmDialog
	bind:show={showDeleteConfirm}
	on:confirm={handleDelete}
	title={$i18n.t('Delete Skill')}
	message={
		deletingSkill
			? $i18n.t('This will permanently delete {{name}}.', { name: deletingSkill.name })
			: $i18n.t('Are you sure you want to delete this skill?')
	}
/>

<AccessControlModal
	bind:show={showAccessControlModal}
	bind:accessControl
	accessRoles={['read', 'write']}
	allowPublic={$user?.role === 'admin'}
	allowUserSelection={$user?.role === 'admin'}
	readOnly={!canManageAcl}
/>

{#if !loaded}
	<div class="flex min-h-[18rem] items-center justify-center">
		<Spinner className="size-8 text-gray-500" />
	</div>
{:else}
	<div class="flex flex-col gap-4">
		<div class="workspace-section">
			<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="max-w-3xl space-y-3">
					<div class="flex flex-wrap items-center gap-3">
						<div class="text-base font-semibold tracking-tight text-gray-900 dark:text-gray-100">
							{$i18n.t('Skills')}
						</div>
						<div class="workspace-count-pill">
							{installedSkills.length} {$i18n.t('Installed')}
						</div>
					</div>

					<p class="max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300">
						{$i18n.t(
							'Install, import, and manage real SKILL.md packages from LobeHub, community sources, or your own custom skills.'
						)}
					</p>
					<p class="max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
						{$i18n.t(
							'This page manages skills only. It is no longer a dump of workspace tools or generic assistant presets.'
						)}
					</p>

					<div class="flex flex-wrap gap-2">
						<div
							class="glass-item px-3 py-2 text-sm"
						>
							<div class="text-[11px] uppercase tracking-[0.2em] text-gray-400">LobeHub</div>
							<div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">
								{lobehubInstalledCount}
							</div>
						</div>
						<div
							class="glass-item px-3 py-2 text-sm"
						>
							<div class="text-[11px] uppercase tracking-[0.2em] text-gray-400">
								{$i18n.t('Community')}
							</div>
							<div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">
								{communityInstalledCount}
							</div>
						</div>
						<div
							class="glass-item px-3 py-2 text-sm"
						>
							<div class="text-[11px] uppercase tracking-[0.2em] text-gray-400">
								{$i18n.t('Custom')}
							</div>
							<div class="mt-1 font-semibold text-gray-900 dark:text-gray-100">
								{customInstalledCount}
							</div>
						</div>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<button
						class="workspace-secondary-button"
						on:click={() => refreshData()}
					>
						<ArrowPath className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
						{$i18n.t('Refresh')}
					</button>

					<button
						class="workspace-primary-button"
						on:click={() => (showStore = true)}
					>
						<Sparkles className="size-4" />
						{$i18n.t('Skill Store')}
					</button>
				</div>
			</div>
		</div>

		<div class="workspace-section flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div class="text-sm text-gray-500 dark:text-gray-400">
				{$i18n.t('Showing installed skill packages only.')}
			</div>

			<div class="workspace-search w-full md:max-w-md">
				<Search className="size-4 text-gray-400" />
				<input
					class="w-full bg-transparent text-sm outline-none"
					bind:value={mainQuery}
					placeholder={$i18n.t('Search installed skills')}
				/>
			</div>
		</div>

		{#if filteredInstalledSkills.length > 0}
			<div class="space-y-3">
				{#each filteredInstalledSkills as skill (skill.id)}
					{@const Icon = getSkillIcon(skill)}
					{@const tags = getSkillTags(skill)}
					{@const sourceUrl = getSkillSourceUrl(skill)}
					{@const categoryLabel = getSkillCategoryLabel(skill)}
					<div class="glass-item rounded-[1.5rem] p-4 transition">
						<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
							<div class="flex min-w-0 gap-4">
								<div
									class={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${getSkillIconAccent(skill)} text-white shadow-sm`}
								>
									<svelte:component this={Icon} className="size-6" />
								</div>

								<div class="min-w-0 flex-1">
									<div class="mb-2 flex flex-wrap items-center gap-2">
										<span
											class={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSkillSourceBadgeClass(skill)}`}
										>
											{getSkillSourceBadge(skill)}
										</span>
										<span
											class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
										>
											{$i18n.t('Installed')}
										</span>
										{#if categoryLabel}
											<span
												class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
											>
												{categoryLabel}
											</span>
										{/if}
										{#if getSkillPackageFileCount(skill) > 0}
											<span
												class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
											>
												{getSkillPackageFileCount(skill)} {$i18n.t('files')}
											</span>
										{/if}
									</div>

									<div class="text-base font-semibold text-gray-900 dark:text-gray-100">
										{skill.name}
									</div>

									{#if skill.description}
										<div class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
											{skill.description}
										</div>
									{/if}

									{#if tags.length > 0}
										<div class="mt-3 flex flex-wrap gap-2">
											{#each tags as tag}
												<span
													class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
												>
													{tag}
												</span>
											{/each}
										</div>
									{/if}

									<div
										class="mt-4 flex min-w-0 flex-col gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
									>
										{#if sourceUrl}
											<a
												class="inline-flex max-w-full items-center gap-1 truncate text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
												href={sourceUrl}
												target="_blank"
												rel="noreferrer"
											>
												<Link className="size-3.5 shrink-0" />
												<span class="truncate">{sourceUrl}</span>
											</a>
										{:else}
											<span class="truncate">{getSkillMetaLine(skill)}</span>
										{/if}
									</div>
								</div>
							</div>

							<div class="flex shrink-0 flex-wrap items-center gap-2">
								<button
									class="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
									on:click={() => openEditSkillModal(skill.id)}
								>
									<Pencil className="size-3.5" />
									{$i18n.t('Edit')}
								</button>

								<button
									class="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
									on:click={() => confirmDeleteSkill(skill.id)}
								>
									<GarbageBin className="size-3.5" />
									{$i18n.t('Delete')}
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="rounded-[1.5rem] border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900"
			>
				<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
					<Sparkles className="size-6 text-gray-500 dark:text-gray-300" />
				</div>
				<div class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
					{$i18n.t('No installed skills yet')}
				</div>
				<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
					{mainQuery
						? $i18n.t('No installed skills match your search.')
						: $i18n.t('Open the Skill Store to install a real skill package or create your own custom skill.')}
				</div>
				<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
					<button
						class="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
						on:click={() => (showStore = true)}
					>
						<Sparkles className="size-4" />
						{$i18n.t('Open Skill Store')}
					</button>
					<button
						class="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
						on:click={openCreateSkillModal}
					>
						<Plus className="size-4" />
						{$i18n.t('New Skill')}
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<Modal
	size="2xl"
	bind:show={showStore}
	className="bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-[1.75rem]"
	containerClassName="p-4"
>
	<div class="flex max-h-[85vh] flex-col">
		<div
			class="sticky top-0 z-10 border-b border-gray-100 bg-white/90 px-6 py-5 backdrop-blur dark:border-gray-800 dark:bg-gray-950/90"
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<div class="text-xl font-semibold text-gray-900 dark:text-gray-100">
						{$i18n.t('Skill Store')}
					</div>
					<div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
						{$i18n.t(
							'Browse verified LobeHub skills, community imports, and your own custom skill packages.'
						)}
					</div>
				</div>

				<button
					class="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-850 dark:hover:text-gray-200"
					on:click={() => (showStore = false)}
				>
					<XMark className="size-5" />
				</button>
			</div>

			<div class="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
				<div class="inline-flex rounded-2xl bg-gray-100 p-1 dark:bg-gray-900">
					{#each STORE_TABS as tab}
						<button
							class={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
								storeTab === tab
									? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
									: 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
							}`}
							on:click={() => {
								storeTab = tab;
							}}
						>
							<span>{getTabLabel(tab)}</span>
							<span
								class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-300"
							>
								{tab === 'lobehub'
									? VERIFIED_LOBEHUB_SKILLS.length
									: tab === 'community'
										? communityStoreSkills.length
										: customStoreSkills.length}
							</span>
						</button>
					{/each}
				</div>

				<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
					<div
						class="flex w-full items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm sm:w-80 dark:border-gray-800 dark:bg-gray-900"
					>
						<Search className="size-4 text-gray-400" />
						<input
							class="w-full bg-transparent text-sm outline-none"
							bind:value={storeQuery}
							placeholder={$i18n.t('Search in this tab')}
						/>
					</div>

					<Dropdown bind:show={showAddMenu} align="end">
						<button
							class="inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
						>
							<Plus className="size-4" />
							{$i18n.t('Add')}
						</button>

						<div slot="content">
							<DropdownMenu.Content
								class="z-50 w-56 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-gray-900 dark:text-white"
								sideOffset={8}
								side="bottom"
								align="end"
								transition={flyAndScale}
							>
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-850"
									on:click={openCreateSkillModal}
								>
									<Sparkles className="size-4" />
									{$i18n.t('New Skill')}
								</DropdownMenu.Item>

								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-850"
									on:click={() => openImportModal('url')}
								>
									<Link className="size-4" />
									{$i18n.t('Import from URL')}
								</DropdownMenu.Item>

								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-850"
									on:click={() => openImportModal('github')}
								>
									<CloudArrowUp className="size-4" />
									{$i18n.t('Import from GitHub')}
								</DropdownMenu.Item>

								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-850"
									on:click={triggerZipImport}
								>
									<DocumentArrowUpSolid className="size-4" />
									{$i18n.t('Upload ZIP')}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</div>
					</Dropdown>
				</div>
			</div>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
			{#if storeTab === 'lobehub'}
				{#if filteredLobeHubSkills.length > 0}
					<div class="space-y-3">
						{#each filteredLobeHubSkills as entry (entry.id)}
							{@const installedSkill = getInstalledCatalogSkill(entry)}
							{@const Icon = CATALOG_ICON_MAP[entry.icon]}
							<div
								class="rounded-[1.5rem] border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
							>
								<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
									<div class="flex min-w-0 gap-4">
										<div
											class={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${entry.accent} text-white shadow-sm`}
										>
											<svelte:component this={Icon} className="size-6" />
										</div>

										<div class="min-w-0 flex-1">
											<div class="mb-2 flex flex-wrap items-center gap-2">
												<span
													class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													LobeHub
												</span>
												<span
													class={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
														installedSkill
															? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
															: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
													}`}
												>
													{installedSkill ? $i18n.t('Installed') : $i18n.t('Available')}
												</span>
												<span
													class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
												>
													{getCatalogCategoryLabel(entry)}
												</span>
											</div>

											<div class="text-base font-semibold text-gray-900 dark:text-gray-100">
												{$i18n.t(entry.title)}
											</div>

											<div class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
												{$i18n.t(entry.description)}
											</div>

											<div
												class="mt-4 flex min-w-0 flex-col gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
											>
												<a
													class="inline-flex max-w-full items-center gap-1 truncate text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
													href={entry.skillUrl}
													target="_blank"
													rel="noreferrer"
												>
													<Link className="size-3.5 shrink-0" />
													<span class="truncate">{entry.skillUrl}</span>
												</a>
											</div>
										</div>
									</div>

									<div class="flex shrink-0 flex-wrap items-center gap-2">
										{#if installedSkill}
											<button
												class="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
												on:click={() => openEditSkillModal(installedSkill.id)}
											>
												<Pencil className="size-3.5" />
												{$i18n.t('Edit')}
											</button>

											<button
												class="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
												on:click={() => confirmDeleteSkill(installedSkill.id)}
											>
												<GarbageBin className="size-3.5" />
												{$i18n.t('Delete')}
											</button>
										{:else}
											<button
												class="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
												on:click={() => installCatalogSkill(entry)}
												disabled={installingCatalogSkillId === entry.id}
											>
												{#if installingCatalogSkillId === entry.id}
													<Spinner className="size-4" />
												{/if}
												{$i18n.t('Install')}
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="rounded-[1.5rem] border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900"
					>
						<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
							<Sparkles className="size-6 text-gray-500 dark:text-gray-300" />
						</div>
						<div class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
							{$i18n.t('Nothing here yet')}
						</div>
						<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
							{storeQuery
								? $i18n.t('No skills in this tab match your search.')
								: $i18n.t('No verified LobeHub skills are available right now.')}
						</div>
					</div>
				{/if}
			{:else if storeTab === 'community'}
				{#if filteredCommunitySkills.length > 0}
					<div class="space-y-3">
						{#each filteredCommunitySkills as skill (skill.id)}
							{@const Icon = getSkillIcon(skill)}
							{@const tags = getSkillTags(skill)}
							<div
								class="rounded-[1.5rem] border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
							>
								<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
									<div class="flex min-w-0 gap-4">
										<div
											class={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${getSkillIconAccent(skill)} text-white shadow-sm`}
										>
											<svelte:component this={Icon} className="size-6" />
										</div>

										<div class="min-w-0 flex-1">
											<div class="mb-2 flex flex-wrap items-center gap-2">
												<span
													class={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSkillSourceBadgeClass(skill)}`}
												>
													{getSkillSourceBadge(skill)}
												</span>
												<span
													class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													{$i18n.t('Installed')}
												</span>
												{#if getSkillPackageFileCount(skill) > 0}
													<span
														class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
													>
														{getSkillPackageFileCount(skill)} {$i18n.t('files')}
													</span>
												{/if}
											</div>

											<div class="text-base font-semibold text-gray-900 dark:text-gray-100">
												{skill.name}
											</div>

											{#if skill.description}
												<div class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
													{skill.description}
												</div>
											{/if}

											{#if tags.length > 0}
												<div class="mt-3 flex flex-wrap gap-2">
													{#each tags as tag}
														<span
															class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
														>
															{tag}
														</span>
													{/each}
												</div>
											{/if}

											<div
												class="mt-4 flex min-w-0 flex-col gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
											>
												{#if getSkillSourceUrl(skill)}
													<a
														class="inline-flex max-w-full items-center gap-1 truncate text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
														href={getSkillSourceUrl(skill)}
														target="_blank"
														rel="noreferrer"
													>
														<Link className="size-3.5 shrink-0" />
														<span class="truncate">{getSkillSourceUrl(skill)}</span>
													</a>
												{:else}
													<span>{getSkillMetaLine(skill)}</span>
												{/if}
											</div>
										</div>
									</div>

									<div class="flex shrink-0 flex-wrap items-center gap-2">
										<button
											class="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
											on:click={() => openEditSkillModal(skill.id)}
										>
											<Pencil className="size-3.5" />
											{$i18n.t('Edit')}
										</button>

										<button
											class="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
											on:click={() => confirmDeleteSkill(skill.id)}
										>
											<GarbageBin className="size-3.5" />
											{$i18n.t('Delete')}
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="rounded-[1.5rem] border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900"
					>
						<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
							<Sparkles className="size-6 text-gray-500 dark:text-gray-300" />
						</div>
						<div class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
							{$i18n.t('Nothing here yet')}
						</div>
						<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
							{storeQuery
								? $i18n.t('No skills in this tab match your search.')
								: $i18n.t('Import a SKILL.md package from a URL, GitHub repository, or ZIP file.')}
						</div>
						<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
							<button
								class="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
								on:click={() => openImportModal('url')}
							>
								<Link className="size-4" />
								{$i18n.t('Import from URL')}
							</button>
							<button
								class="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
								on:click={triggerZipImport}
							>
								<DocumentArrowUpSolid className="size-4" />
								{$i18n.t('Upload ZIP')}
							</button>
						</div>
					</div>
				{/if}
			{:else if filteredCustomSkills.length > 0}
				<div class="space-y-3">
					{#each filteredCustomSkills as skill (skill.id)}
						{@const Icon = getSkillIcon(skill)}
						{@const tags = getSkillTags(skill)}
						<div
							class="rounded-[1.5rem] border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
						>
							<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
								<div class="flex min-w-0 gap-4">
									<div
										class={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${getSkillIconAccent(skill)} text-white shadow-sm`}
									>
										<svelte:component this={Icon} className="size-6" />
									</div>

									<div class="min-w-0 flex-1">
										<div class="mb-2 flex flex-wrap items-center gap-2">
											<span
												class={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSkillSourceBadgeClass(skill)}`}
											>
												{getSkillSourceBadge(skill)}
											</span>
											<span
												class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
											>
												{$i18n.t('Installed')}
											</span>
										</div>

										<div class="text-base font-semibold text-gray-900 dark:text-gray-100">
											{skill.name}
										</div>

										{#if skill.description}
											<div class="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
												{skill.description}
											</div>
										{/if}

										{#if tags.length > 0}
											<div class="mt-3 flex flex-wrap gap-2">
												{#each tags as tag}
													<span
														class="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
													>
														{tag}
													</span>
												{/each}
											</div>
										{/if}

										<div
											class="mt-4 flex min-w-0 flex-col gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
										>
											<span>{getSkillMetaLine(skill)}</span>
										</div>
									</div>
								</div>

								<div class="flex shrink-0 flex-wrap items-center gap-2">
									<button
										class="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
										on:click={() => openEditSkillModal(skill.id)}
									>
										<Pencil className="size-3.5" />
										{$i18n.t('Edit')}
									</button>

									<button
										class="inline-flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/30"
										on:click={() => confirmDeleteSkill(skill.id)}
									>
										<GarbageBin className="size-3.5" />
										{$i18n.t('Delete')}
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div
					class="rounded-[1.5rem] border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900"
				>
					<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
						<Sparkles className="size-6 text-gray-500 dark:text-gray-300" />
					</div>
					<div class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
						{$i18n.t('Nothing here yet')}
					</div>
					<div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
						{storeQuery
							? $i18n.t('No skills in this tab match your search.')
							: $i18n.t('Create a custom skill for your own workflow.')}
					</div>
					<div class="mt-5 flex flex-wrap items-center justify-center gap-2">
						<button
							class="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
							on:click={openCreateSkillModal}
						>
							<Plus className="size-4" />
							{$i18n.t('New Skill')}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</Modal>

<Modal
	size="md"
	bind:show={showImportModal}
	className="bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-[1.75rem]"
>
	<div class="p-6">
		<div class="flex items-start justify-between gap-4">
			<div>
				<div class="text-lg font-semibold text-gray-900 dark:text-gray-100">
					{importType === 'github' ? $i18n.t('Import from GitHub') : $i18n.t('Import from URL')}
				</div>
				<div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
					{importType === 'github'
						? $i18n.t('Paste a GitHub repository URL or a tree path that contains a SKILL.md file.')
						: $i18n.t('Paste a direct URL to a SKILL.md file.')}
				</div>
			</div>

			<button
				class="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-850 dark:hover:text-gray-200"
				on:click={() => (showImportModal = false)}
			>
				<XMark className="size-5" />
			</button>
		</div>

		<div class="mt-5">
			<label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200" for="skill-import-url">
				{importType === 'github' ? $i18n.t('GitHub URL') : $i18n.t('SKILL.md URL')}
			</label>
			<input
				id="skill-import-url"
				class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-700"
				bind:value={importValue}
				placeholder={
					importType === 'github'
						? 'https://github.com/org/repo/tree/main/skill-path'
						: 'https://example.com/SKILL.md'
				}
			/>
		</div>

		<div class="mt-6 flex justify-end gap-2">
			<button
				class="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
				on:click={() => (showImportModal = false)}
			>
				{$i18n.t('Cancel')}
			</button>
			<button
				class="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
				on:click={handleImport}
				disabled={importLoading}
			>
				{#if importLoading}
					<Spinner className="size-4" />
				{/if}
				{$i18n.t('Import')}
			</button>
		</div>
	</div>
</Modal>

<Modal
	size="lg"
	bind:show={showEditor}
	className="bg-white/95 dark:bg-gray-950/95 backdrop-blur-xl rounded-[1.75rem]"
>
	<div class="flex max-h-[85vh] flex-col">
		<div class="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5 dark:border-gray-800">
			<div>
				<div class="text-lg font-semibold text-gray-900 dark:text-gray-100">
					{editingSkill ? $i18n.t('Edit Skill') : $i18n.t('New Skill')}
				</div>
				<div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
					{$i18n.t('Skills still reuse the existing prompt-skill injection flow for compatibility.')}
				</div>
			</div>

			<button
				class="rounded-xl p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-850 dark:hover:text-gray-200"
				on:click={() => (showEditor = false)}
			>
				<XMark className="size-5" />
			</button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
			<div class="space-y-4">
				<div>
					<label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200" for="skill-name">
						{$i18n.t('Name')}
					</label>
					<input
						id="skill-name"
						class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-700"
						bind:value={skillForm.name}
						placeholder={$i18n.t('e.g. Release Notes Writer')}
					/>
				</div>

				<div>
					<label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200" for="skill-description">
						{$i18n.t('Description')}
					</label>
					<input
						id="skill-description"
						class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-700"
						bind:value={skillForm.description}
						placeholder={$i18n.t('Describe when this skill should be used')}
					/>
				</div>

				<div>
					<label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200" for="skill-tags">
						{$i18n.t('Tags')}
					</label>
					<input
						id="skill-tags"
						class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-700"
						bind:value={skillForm.tags}
						placeholder={$i18n.t('Comma-separated tags')}
					/>
				</div>

				<div>
					<label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200" for="skill-content">
						{$i18n.t('Content')}
					</label>
					<textarea
						id="skill-content"
						class="min-h-[18rem] w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-gray-400 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-700"
						bind:value={skillForm.content}
						placeholder={$i18n.t('Write the instructions that should be injected when this skill is selected...')}
					></textarea>
				</div>

				{#if editingSkill && getSkillSource(editingSkill) === 'lobehub'}
					<div class="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
						<div class="font-medium text-gray-800 dark:text-gray-100">{$i18n.t('LobeHub Skill')}</div>
						<div class="mt-1">LobeHub</div>
						{#if getSkillSourceUrl(editingSkill)}
							<a
								class="mt-2 inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
								href={getSkillSourceUrl(editingSkill)}
								target="_blank"
								rel="noreferrer"
							>
								<Link className="size-3.5" />
								<span class="truncate">{getSkillSourceUrl(editingSkill)}</span>
							</a>
						{/if}
					</div>
				{:else if editingSkill?.source && editingSkill.source !== 'manual'}
					<div class="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
						<div class="font-medium text-gray-800 dark:text-gray-100">{$i18n.t('Imported Skill')}</div>
						<div class="mt-1">{getImportSourceLabel(editingSkill.source)}</div>
						{#if getSkillSourceUrl(editingSkill)}
							<a
								class="mt-2 inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
								href={getSkillSourceUrl(editingSkill)}
								target="_blank"
								rel="noreferrer"
							>
								<Link className="size-3.5" />
								<span class="truncate">{getSkillSourceUrl(editingSkill)}</span>
							</a>
						{/if}
					</div>
				{/if}
			</div>
		</div>

			<div class="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
				<button
					class="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:hover:bg-transparent dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850 dark:disabled:hover:bg-transparent disabled:opacity-60 disabled:cursor-not-allowed"
					disabled={!canManageAcl}
					on:click={() => {
						if (!canManageAcl) return;
						showAccessControlModal = true;
					}}
				>
				<LockClosed className="size-4" />
				{accessControl === null ? $i18n.t('Public') : $i18n.t('Restricted')}
			</button>

			<div class="flex items-center gap-2">
				<button
					class="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-850"
					on:click={() => (showEditor = false)}
				>
					{$i18n.t('Cancel')}
				</button>
				<button
					class="rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
					on:click={saveSkill}
				>
					{editingSkill ? $i18n.t('Save') : $i18n.t('Create')}
				</button>
			</div>
		</div>
	</div>
</Modal>
