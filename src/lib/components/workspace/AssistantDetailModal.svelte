<script lang="ts">
	import { getContext, createEventDispatcher } from 'svelte';
	import Modal from '../common/Modal.svelte';
	import ChevronRight from '../icons/ChevronRight.svelte';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	export let show = false;
	export let agent: any = null;

	const handleStartChat = () => {
		dispatch('startChat', agent);
	};

	const handleAdd = () => {
		dispatch('add', agent);
	};
</script>

<Modal bind:show size="md">
	{#if agent}
		<div class="p-6">
			<!-- 头部：图标 + 名称 -->
			<div class="flex items-start gap-4 mb-4">
				<div
					class="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl shrink-0"
				>
					{agent.emoji || '🤖'}
				</div>
				<div class="flex-1 min-w-0">
					<h2 class="text-xl font-semibold">{agent.name}</h2>
					{#if agent.description}
						<p class="text-sm text-gray-500 mt-1">{agent.description}</p>
					{/if}
				</div>
			</div>

			<!-- 分组标签 -->
			{#if agent.group && agent.group.length > 0}
				<div class="flex flex-wrap gap-1.5 mb-4">
					{#each agent.group as tag}
						<span
							class="px-2.5 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
						>
							{tag}
						</span>
					{/each}
				</div>
			{/if}

			<hr class="border-gray-100 dark:border-gray-800 my-4" />

			<!-- 系统提示词 -->
			<div class="mb-4">
				<div class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
					{$i18n.t('System Prompt')}
				</div>
				<div
					class="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-850 rounded-xl p-4 max-h-80 overflow-y-auto whitespace-pre-wrap leading-relaxed"
				>
					{agent.prompt || ''}
				</div>
			</div>

			<!-- 底部操作按钮 -->
			<div class="flex justify-end gap-2 mt-6">
				<button
					class="px-4 py-2 text-sm rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
					on:click={() => (show = false)}
				>
					{$i18n.t('Close')}
				</button>
				<button
					class="px-4 py-2 text-sm rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
					on:click={handleAdd}
				>
					{$i18n.t('Add to workspace')}
				</button>
				<button
					class="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
					on:click={handleStartChat}
				>
					{$i18n.t('Start Chat')}
					<ChevronRight className="size-4" />
				</button>
			</div>
		</div>
	{/if}
</Modal>
