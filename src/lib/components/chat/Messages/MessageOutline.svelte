<script lang="ts">
	import type { HeadingItem } from '$lib/utils/headings';

	export let headings: HeadingItem[] = [];
	export let visible = false;
	export let onSelect: ((heading: HeadingItem) => void) | undefined = undefined;

	let hitboxElement: HTMLDivElement | null = null;
	let bodyElement: HTMLDivElement | null = null;
	let isHitboxHovered = false;
	let isBodyHovered = false;
	let hasFocusWithin = false;

	$: minDepth = headings.length > 0 ? Math.min(...headings.map((h) => h.depth)) : 1;
	$: isVisible = visible || isHitboxHovered || isBodyHovered || hasFocusWithin;
	$: isExpanded = isBodyHovered || hasFocusWithin;

	const barWidth = (depth: number) => Math.max(4, 16 - depth * 2);
	const indent = (depth: number) => Math.max(0, depth - minDepth) * 10;
	const fontSize = (depth: number) => Math.max(11, 14 - depth);

	const containsTarget = (element: HTMLElement | null, target: EventTarget | null) =>
		element && target instanceof Node ? element.contains(target) : false;

	const handleHitboxMouseLeave = (event: MouseEvent) => {
		if (containsTarget(bodyElement, event.relatedTarget)) {
			return;
		}

		isHitboxHovered = false;
	};

	const handleBodyMouseLeave = (event: MouseEvent) => {
		isBodyHovered = false;

		if (containsTarget(hitboxElement, event.relatedTarget)) {
			isHitboxHovered = true;
		}
	};

	const handleFocusOut = (event: FocusEvent) => {
		const currentTarget = event.currentTarget as HTMLElement | null;
		const relatedTarget = event.relatedTarget as Node | null;

		if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
			return;
		}

		hasFocusWithin = false;
	};
</script>

<div class="message-outline-root">
	<div
		class="message-outline-track"
		style="--outline-count:{headings.length}"
	>
		<div
			class="message-outline-hitbox"
			bind:this={hitboxElement}
			on:mouseenter={() => {
				isHitboxHovered = true;
			}}
			on:mouseleave={handleHitboxMouseLeave}
		/>
		<div
			class="message-outline-body"
			class:message-outline-body-visible={isVisible}
			class:message-outline-body-expanded={isExpanded}
			style="--outline-count:{headings.length}"
			bind:this={bodyElement}
			aria-hidden={!isVisible}
			on:mouseenter={() => {
				isBodyHovered = true;
			}}
			on:mouseleave={handleBodyMouseLeave}
			on:focusin={() => {
				hasFocusWithin = true;
			}}
			on:focusout={handleFocusOut}
		>
			{#each headings as heading (heading.id)}
				<button
					type="button"
					class="message-outline-item"
					title={heading.text}
					tabindex={isVisible ? 0 : -1}
					on:click={() => onSelect?.(heading)}
				>
					<span
						class="message-outline-bar"
						style="--bar-w:{barWidth(heading.depth)}px"
						aria-hidden="true"
					/>
					<span
						class="message-outline-label"
						style="--indent:{indent(heading.depth)}px; --font-size:{fontSize(heading.depth)}px"
					>
						{heading.text}
					</span>
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.message-outline-root {
		position: absolute;
		inset: 0;
		z-index: 20;
		pointer-events: none;
	}

	.message-outline-track {
		position: sticky;
		top: max(calc(50% - var(--outline-count) * 14px), 20px);
		display: inline-flex;
		margin-left: -18px;
		max-width: calc(50% + 18px);
		pointer-events: none;
	}

	.message-outline-hitbox {
		width: 18px;
		height: min(calc(var(--outline-count) * 28px + 12px), 70vh);
		min-height: 40px;
		pointer-events: auto;
	}

	.message-outline-body {
		max-width: calc(100% - 18px);
		max-height: min(100%, 70vh);
		display: inline-flex;
		flex-direction: column;
		padding: 8px 0 8px 6px;
		gap: 4px;
		border-radius: 10px;
		opacity: 0;
		transform: translateX(-6px);
		pointer-events: none;
		overflow-x: hidden;
		overflow-y: hidden;
		transition:
			opacity 220ms ease,
			transform 220ms ease,
			padding 200ms ease,
			background-color 200ms ease,
			box-shadow 200ms ease;
	}

	.message-outline-body-visible {
		opacity: 1;
		transform: translateX(0);
		pointer-events: auto;
	}

	.message-outline-body-expanded {
		padding: 8px 12px 8px 8px;
		overflow-y: auto;
		background: rgba(255, 255, 255, 0.95);
		box-shadow: 0 0 12px rgba(0, 0, 0, 0.08);
	}

	:global(.dark) .message-outline-body-expanded {
		background: rgba(30, 41, 59, 0.95);
		box-shadow: 0 0 12px rgba(0, 0, 0, 0.3);
	}

	/* scrollbar hidden */
	.message-outline-body::-webkit-scrollbar {
		display: none;
	}
	.message-outline-body {
		scrollbar-width: none;
	}

	.message-outline-item {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
		flex-shrink: 0;
	}

	.message-outline-item:hover .message-outline-label {
		color: rgb(15 23 42);
	}

	:global(.dark) .message-outline-item:hover .message-outline-label {
		color: rgb(241 245 249);
	}

	.message-outline-item:hover .message-outline-bar {
		background: rgb(100 116 139);
	}

	:global(.dark) .message-outline-item:hover .message-outline-bar {
		background: rgb(148 163 184);
	}

	.message-outline-bar {
		width: var(--bar-w);
		height: 3px;
		border-radius: 1.5px;
		flex-shrink: 0;
		background: rgb(203 213 225);
		transition: background 200ms ease;
	}

	:global(.dark) .message-outline-bar {
		background: rgb(71 85 105);
	}

	.message-outline-label {
		opacity: 0;
		display: none;
		font-size: var(--font-size);
		padding-left: var(--indent);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: rgb(100 116 139);
		transition:
			opacity 200ms ease,
			color 150ms ease;
		line-height: 1.4;
	}

	:global(.dark) .message-outline-label {
		color: rgb(148 163 184);
	}

	.message-outline-body-expanded .message-outline-label {
		opacity: 1;
		display: block;
	}

	@media (prefers-reduced-motion: reduce) {
		.message-outline-body,
		.message-outline-bar,
		.message-outline-label {
			transition: none;
		}

		.message-outline-body {
			transform: none;
		}
	}
</style>
