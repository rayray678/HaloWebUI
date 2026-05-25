<script lang="ts">
	import { getContext } from 'svelte';

	import type { Writable } from 'svelte/store';
	import type { WorkspaceTabMeta } from './meta';

	const i18n: Writable<any> = getContext('i18n');

	export let activeTab: WorkspaceTabMeta | null = null;
	export let tabs: WorkspaceTabMeta[] = [];
	export let pathname = '';

	const swapTabs = (
		items: WorkspaceTabMeta[],
		firstKey: WorkspaceTabMeta['key'],
		secondKey: WorkspaceTabMeta['key']
	) => {
		const reordered = [...items];
		const firstIndex = reordered.findIndex((tab) => tab.key === firstKey);
		const secondIndex = reordered.findIndex((tab) => tab.key === secondKey);

		if (firstIndex === -1 || secondIndex === -1) return reordered;

		[reordered[firstIndex], reordered[secondIndex]] = [
			reordered[secondIndex],
			reordered[firstIndex]
		];

		return reordered;
	};

	const swapWorkspaceHeroTabs = (items: WorkspaceTabMeta[]) => {
		let reordered = swapTabs(items, 'tools', 'images');
		reordered = swapTabs(reordered, 'tools', 'terminal');
		reordered = swapTabs(reordered, 'images', 'skills');
		return reordered;
	};

	const getWorkspaceHeroTabLabel = (tab: WorkspaceTabMeta | null) => {
		if (!tab) return '';
		if (tab.key !== 'terminal') return $i18n.t(tab.labelKey);

		const filesLabel = $i18n.t('Files');
		const terminalLabel = $i18n.t('Terminal');
		const useCompactJoin = /[\u3040-\u30ff\u3400-\u9fff]/.test(`${filesLabel}${terminalLabel}`);

		return `${filesLabel}${useCompactJoin ? '' : ' '}${terminalLabel}`;
	};

	$: heroTabs = swapWorkspaceHeroTabs(tabs);
	$: splitIndex = Math.ceil(heroTabs.length / 2);
	$: tabRows = [heroTabs.slice(0, splitIndex), heroTabs.slice(splitIndex)].filter(
		(row) => row.length > 0
	);
</script>

{#if activeTab}
	<section class="glass-section p-5 space-y-5">
		<div class="@container flex flex-col gap-5">
			<div class="flex flex-col gap-4">
				<div class="min-w-0 @[64rem]:flex-1">
					<div class="flex items-start gap-3">
						<div class="glass-icon-badge shrink-0 {activeTab.badgeColor}">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="currentColor"
								class="size-[18px] {activeTab.iconColor}"
							>
								{#each activeTab.iconPaths as pathD}
									<path fill-rule="evenodd" d={pathD} clip-rule="evenodd" />
								{/each}
							</svg>
						</div>
						<div class="min-w-0 max-w-3xl">
							<div class="text-base font-semibold text-gray-800 dark:text-gray-100">
								{getWorkspaceHeroTabLabel(activeTab)}
							</div>
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
								{$i18n.t(activeTab.descKey)}
							</p>
						</div>
					</div>
				</div>

				<div
					class="inline-flex max-w-full flex-col gap-1.5 self-start rounded-xl bg-gray-100/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:bg-gray-850/80 dark:shadow-none @[64rem]:shrink-0"
				>
					{#each tabRows as row (row[0]?.key ?? 'row')}
						<div class="flex max-w-full flex-wrap items-center gap-1.5">
							{#each row as tab (tab.key)}
								<a
									class={`flex items-center justify-start gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all ${
										tab.activeMatch.some((prefix) => pathname.startsWith(prefix))
											? 'bg-white text-gray-900 shadow-[0_1px_3px_rgba(15,23,42,0.08)] dark:bg-gray-800 dark:text-white'
											: 'text-gray-500 hover:bg-white/50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/50 dark:hover:text-gray-200'
									}`}
									href={tab.href}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="currentColor"
										class="size-4"
									>
										{#each tab.iconPaths as pathD}
											<path fill-rule="evenodd" d={pathD} clip-rule="evenodd" />
										{/each}
									</svg>
									<span>{getWorkspaceHeroTabLabel(tab)}</span>
								</a>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</section>
{/if}
