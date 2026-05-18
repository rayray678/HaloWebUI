<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, onDestroy, getContext } from 'svelte';
	import { user, models, socket } from '$lib/stores';
	import {
		getNotes,
		getNoteById,
		createNewNote,
		updateNoteById,
		deleteNoteById
	} from '$lib/apis/notes';
	import { generateTitle } from '$lib/apis';
	import { uploadFile } from '$lib/apis/files';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import Tooltip from '../common/Tooltip.svelte';
	import ConfirmDialog from '../common/ConfirmDialog.svelte';
	import Search from '../icons/Search.svelte';
	import Plus from '../icons/Plus.svelte';
	import GarbageBin from '../icons/GarbageBin.svelte';
	import Spinner from '../common/Spinner.svelte';
	import HaloSelect from '$lib/components/common/HaloSelect.svelte';

	const i18n = getContext('i18n');

	let loaded = false;
	let notes: any[] = [];
	let filteredItems: any[] = [];
	let query = '';
	let sortBy = 'updated'; // 'name' | 'updated' | 'created'

	let showEditor = false;
	let editingNote: any = null;
	let noteForm: any = { title: '', content: '' };
	let openingNoteId = '';

	let showDeleteConfirm = false;
	let deletingNoteId = '';

	let generatingTitle = false;
	let uploadingImage = false;
	let imageInput: HTMLInputElement;

	// Floating format menu
	let showFormatMenu = false;
	let formatMenuX = 0;
	let formatMenuY = 0;

	// Collaborative editing state
	let activeEditors: Array<{ id: string; name: string; profile_image_url: string }> = [];
	let typingUsers: Set<string> = new Set();
	let typingTimer: ReturnType<typeof setTimeout> | null = null;
	let remoteUpdatePending = false;

	const noteEventHandler = (event: any) => {
		if (!editingNote || event.note_id !== editingNote.id) return;

		const { data, user: eventUser } = event;
		if (!data) return;

		switch (data.type) {
			case 'presence:join':
				if (eventUser && eventUser.id !== $user?.id) {
					activeEditors = [...activeEditors.filter((e) => e.id !== eventUser.id), eventUser];
				}
				break;
			case 'presence:leave':
				if (eventUser) {
					activeEditors = activeEditors.filter((e) => e.id !== eventUser.id);
					typingUsers.delete(eventUser.id);
					typingUsers = typingUsers;
				}
				break;
			case 'presence:list':
				activeEditors = data.editors || [];
				break;
			case 'content:update':
				// Remote user saved — update local content if we're not mid-edit
				if (eventUser?.id !== $user?.id) {
					remoteUpdatePending = true;
					noteForm.title = data.title ?? noteForm.title;
					noteForm.content = data.content ?? noteForm.content;
					editingNote.meta = { ...(editingNote.meta || {}), version: data.version };
					resetHistory();
					remoteUpdatePending = false;
					toast.info($i18n.t('{{name}} updated this note', { name: eventUser?.name || 'Someone' }));
				}
				break;
			case 'typing':
				if (eventUser && eventUser.id !== $user?.id) {
					typingUsers.add(eventUser.id);
					typingUsers = typingUsers;
					// Clear typing after 3 seconds
					setTimeout(() => {
						typingUsers.delete(eventUser.id);
						typingUsers = typingUsers;
					}, 3000);
				}
				break;
		}
	};

	const joinNoteRoom = (noteId: string) => {
		$socket?.emit('note:join', { note_id: noteId });
		$socket?.on('note-events', noteEventHandler);
	};

	const leaveNoteRoom = (noteId: string) => {
		$socket?.emit('note:leave', { note_id: noteId });
		$socket?.off('note-events', noteEventHandler);
		activeEditors = [];
		typingUsers = new Set();
	};

	const emitTyping = () => {
		if (!editingNote || remoteUpdatePending) return;
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(() => {
			$socket?.emit('note:typing', { note_id: editingNote.id });
		}, 300);
	};

	// Undo/redo history stack
	const MAX_HISTORY = 100;
	let undoStack: string[] = [];
	let redoStack: string[] = [];
	let lastSnapshot = '';
	let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

	function pushUndoSnapshot() {
		const current = noteForm.content;
		if (current === lastSnapshot) return;
		undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), lastSnapshot];
		redoStack = [];
		lastSnapshot = current;
	}

	function scheduleSnapshot() {
		if (snapshotTimer) clearTimeout(snapshotTimer);
		snapshotTimer = setTimeout(pushUndoSnapshot, 400);
	}

	function handleUndo() {
		if (undoStack.length === 0) return;
		pushUndoSnapshot();
		redoStack = [...redoStack, noteForm.content];
		noteForm.content = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		lastSnapshot = noteForm.content;
	}

	function handleRedo() {
		if (redoStack.length === 0) return;
		undoStack = [...undoStack, noteForm.content];
		noteForm.content = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		lastSnapshot = noteForm.content;
	}

	function resetHistory() {
		undoStack = [];
		redoStack = [];
		lastSnapshot = noteForm.content;
		if (snapshotTimer) clearTimeout(snapshotTimer);
	}

	// Drag-and-drop reorder
	let dragIndex: number | null = null;
	let dropIndex: number | null = null;

	const handleDragStart = (index: number) => {
		dragIndex = index;
	};

	const handleDragOver = (index: number) => {
		if (dragIndex === null || dragIndex === index) return;
		dropIndex = index;
	};

	const handleDrop = async () => {
		if (dragIndex === null || dropIndex === null || dragIndex === dropIndex) {
			dragIndex = null;
			dropIndex = null;
			return;
		}
		// Reorder the filtered list
		const reordered = [...filteredItems];
		const [moved] = reordered.splice(dragIndex, 1);
		reordered.splice(dropIndex, 0, moved);

		// Assign new order values and update remotely
		const updates: Promise<any>[] = [];
		for (let i = 0; i < reordered.length; i++) {
			const note = reordered[i];
			const newOrder = reordered.length - i; // higher = first
			if ((note.meta?.order ?? 0) !== newOrder) {
				const meta = { ...(note.meta || {}), order: newOrder };
				note.meta = meta;
				updates.push(
					(async () => {
						const fullNote = await fetchFullNote(note);
						return updateNoteById(
							localStorage.token,
							note.id,
							buildNoteUpdatePayload(fullNote, { meta })
						);
					})()
				);
			}
		}
		// Apply reorder locally immediately
		notes = notes.slice().sort((a: any, b: any) => {
			const oa = a.meta?.order ?? 0;
			const ob = b.meta?.order ?? 0;
			if (ob !== oa) return ob - oa;
			return b.updated_at - a.updated_at;
		});
		dragIndex = null;
		dropIndex = null;

		if (updates.length > 0) {
			try {
				await Promise.all(updates);
			} catch {
				toast.error($i18n.t('Failed to save order'));
				await loadNotes();
			}
		}
	};

	$: filteredItems = notes
		.filter(
			(n: any) =>
				query === '' ||
				n.title.toLowerCase().includes(query.toLowerCase()) ||
				n.content.toLowerCase().includes(query.toLowerCase())
		)
		.sort((a: any, b: any) => {
			if (sortBy === 'name') return (a.title || '').localeCompare(b.title || '');
			if (sortBy === 'created') return (b.created_at || 0) - (a.created_at || 0);
			// 'updated' — preserve manual order, fall back to updated_at
			const oa = a.meta?.order ?? 0;
			const ob = b.meta?.order ?? 0;
			if (ob !== oa) return ob - oa;
			return b.updated_at - a.updated_at;
		});

	const loadNotes = async () => {
		notes = (await getNotes(localStorage.token)) ?? [];
	};

	const fetchFullNote = async (note: any) => {
		if (!note?.id) return note;
		return (await getNoteById(localStorage.token, note.id)) ?? note;
	};

	const buildNoteUpdatePayload = (note: any, overrides: any = {}) => ({
		title: overrides.title ?? note?.title ?? '',
		content: overrides.content ?? note?.content ?? '',
		...(note?.data !== undefined ? { data: note.data } : {}),
		meta: overrides.meta ?? note?.meta ?? {},
		...(note?.access_control !== undefined ? { access_control: note.access_control } : {})
	});

	const openCreateModal = () => {
		editingNote = null;
		noteForm = { title: '', content: '' };
		resetHistory();
		showEditor = true;
	};

	const openEditModal = async (note: any) => {
		if (openingNoteId) return;
		openingNoteId = note.id;
		try {
			const fullNote = await fetchFullNote(note);
			editingNote = fullNote;
			noteForm = {
				title: fullNote.title ?? '',
				content: fullNote.content ?? '',
				meta: fullNote.meta || {}
			};
			resetHistory();
			showEditor = true;
			joinNoteRoom(fullNote.id);
		} catch (err) {
			toast.error(`${err}`);
		} finally {
			openingNoteId = '';
		}
	};

	const saveNote = async () => {
		if (!noteForm.title.trim()) {
			toast.error($i18n.t('Title is required'));
			return;
		}
		try {
			if (editingNote) {
				await updateNoteById(localStorage.token, editingNote.id, {
					...buildNoteUpdatePayload(editingNote, {
						title: noteForm.title,
						content: noteForm.content,
						meta: editingNote.meta || {}
					})
				});
				toast.success($i18n.t('Note updated'));
			} else {
				await createNewNote(localStorage.token, noteForm);
				toast.success($i18n.t('Note created'));
			}
			closeEditor();
			await loadNotes();
		} catch (err) {
			toast.error(`${err}`);
		}
	};

	const closeEditor = () => {
		if (editingNote) {
			leaveNoteRoom(editingNote.id);
		}
		showEditor = false;
	};

	const confirmDelete = (id: string) => {
		deletingNoteId = id;
		showDeleteConfirm = true;
	};

	const handleDelete = async () => {
		try {
			await deleteNoteById(localStorage.token, deletingNoteId);
			toast.success($i18n.t('Note deleted'));
			await loadNotes();
		} catch (err) {
			toast.error(`${err}`);
		}
	};

	const handleGenerateTitle = async () => {
		if (!noteForm.content.trim()) {
			toast.error($i18n.t('Write some content first'));
			return;
		}

		const modelList = $models ?? [];
		if (modelList.length === 0) {
			toast.error($i18n.t('No models available'));
			return;
		}
		const modelId = modelList[0]?.id;
		if (!modelId) return;

		generatingTitle = true;
		try {
			const title = await generateTitle(localStorage.token, modelId, [
				{ role: 'user', content: noteForm.content.slice(0, 2000) }
			]);
			if (title && typeof title === 'string') {
				noteForm.title = title;
			}
		} catch (err) {
			toast.error($i18n.t('Failed to generate title'));
		} finally {
			generatingTitle = false;
		}
	};

	const handleCopyContent = async (note: any) => {
		try {
			const fullNote = await fetchFullNote(note);
			await navigator.clipboard.writeText(fullNote.content || '');
			toast.success($i18n.t('Copied to clipboard'));
		} catch {
			toast.error($i18n.t('Failed to copy'));
		}
	};

	const insertChecklist = () => {
		const template = '- [ ] ';
		const textarea = document.getElementById('note-content-textarea') as HTMLTextAreaElement;
		if (!textarea) {
			noteForm.content = noteForm.content + (noteForm.content ? '\n' : '') + template;
			return;
		}
		const start = textarea.selectionStart;
		const before = noteForm.content.slice(0, start);
		const after = noteForm.content.slice(start);
		const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
		noteForm.content = before + prefix + template + after;

		requestAnimationFrame(() => {
			const pos = start + prefix.length + template.length;
			textarea.setSelectionRange(pos, pos);
			textarea.focus();
		});
	};

	const insertTextAtCursor = (text: string) => {
		const textarea = document.getElementById('note-content-textarea') as HTMLTextAreaElement;
		if (!textarea) {
			noteForm.content += text;
			return;
		}
		const start = textarea.selectionStart;
		const before = noteForm.content.slice(0, start);
		const after = noteForm.content.slice(textarea.selectionEnd);
		const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
		noteForm.content = before + prefix + text + after;
		const newPos = start + prefix.length + text.length;
		requestAnimationFrame(() => {
			textarea.setSelectionRange(newPos, newPos);
			textarea.focus();
		});
	};

	const handleImageFile = async (file: File) => {
		if (!file.type.startsWith('image/')) {
			toast.error($i18n.t('Only image files are supported'));
			return;
		}
		if (file.size > 20 * 1024 * 1024) {
			toast.error($i18n.t('Image must be smaller than 20MB'));
			return;
		}
		uploadingImage = true;
		try {
			const result = await uploadFile(localStorage.token, file);
			if (result?.id) {
				const url = `${WEBUI_API_BASE_URL}/files/${result.id}/content`;
				const alt = file.name.replace(/\.[^.]+$/, '');
				insertTextAtCursor(`![${alt}](${url})`);
				scheduleSnapshot();
			}
		} catch (err) {
			toast.error($i18n.t('Failed to upload image'));
		} finally {
			uploadingImage = false;
		}
	};

	const handleImagePaste = (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (file) handleImageFile(file);
				return;
			}
		}
	};

	const wrapSelection = (prefix: string, suffix: string) => {
		const textarea = document.getElementById('note-content-textarea') as HTMLTextAreaElement;
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		if (start === end) return;
		const selected = noteForm.content.slice(start, end);
		const wrapped = prefix + selected + suffix;
		noteForm.content = noteForm.content.slice(0, start) + wrapped + noteForm.content.slice(end);
		showFormatMenu = false;
		scheduleSnapshot();
		requestAnimationFrame(() => {
			textarea.setSelectionRange(start + prefix.length, end + prefix.length);
			textarea.focus();
		});
	};

	const insertLink = () => {
		const textarea = document.getElementById('note-content-textarea') as HTMLTextAreaElement;
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		const selected = noteForm.content.slice(start, end);
		const linked = `[${selected || 'text'}](url)`;
		noteForm.content = noteForm.content.slice(0, start) + linked + noteForm.content.slice(end);
		showFormatMenu = false;
		scheduleSnapshot();
		const urlStart = start + (selected ? selected.length + 3 : 7);
		requestAnimationFrame(() => {
			textarea.setSelectionRange(urlStart, urlStart + 3);
			textarea.focus();
		});
	};

	const checkSelection = () => {
		const textarea = document.getElementById('note-content-textarea') as HTMLTextAreaElement;
		if (!textarea) return;
		const start = textarea.selectionStart;
		const end = textarea.selectionEnd;
		if (start === end) {
			showFormatMenu = false;
			return;
		}
		// Calculate position relative to the textarea's bounding rect
		// Use a temporary span to measure caret position
		const rect = textarea.getBoundingClientRect();
		const modalEl = textarea.closest('.flex.flex-col') as HTMLElement;
		const modalRect = modalEl?.getBoundingClientRect() || rect;
		// Approximate line/col position for the menu
		const textBefore = noteForm.content.slice(0, start);
		const lines = textBefore.split('\n');
		const lineHeight = 20; // approximate line height in px
		const charWidth = 7; // approximate char width in px
		const row = lines.length - 1;
		const col = lines[lines.length - 1].length;
		const selLen = end - start;
		formatMenuX = Math.min(
			Math.max(col * charWidth + (selLen * charWidth) / 2, 40),
			rect.width - 120
		);
		formatMenuY = row * lineHeight - textarea.scrollTop - 40;
		showFormatMenu = true;
	};

	const countChecklist = (content: string) => {
		const all = (content.match(/^- \[[ x]\] /gm) || []).length;
		if (all === 0) return null;
		const done = (content.match(/^- \[x\] /gm) || []).length;
		return { done, all };
	};

	const formatDate = (epoch: number) => {
		return new Date(epoch * 1000).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	};

	onMount(async () => {
		await loadNotes();
		loaded = true;
	});

	onDestroy(() => {
		if (editingNote) {
			leaveNoteRoom(editingNote.id);
		}
	});
</script>

<ConfirmDialog
	bind:show={showDeleteConfirm}
	on:confirm={handleDelete}
	title={$i18n.t('Delete Note')}
	message={$i18n.t('Are you sure you want to delete this note?')}
/>

{#if loaded}
	<div class="space-y-4">
		<section class="workspace-section space-y-4">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-center">
				<div class="workspace-toolbar-summary">
					<div class="workspace-count-pill">
						{filteredItems.length}
						{$i18n.t('Notes')}
					</div>
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t(
							'Capture collaborative notes, drafts, and reference material without leaving the workspace.'
						)}
					</div>
				</div>
				<div class="workspace-toolbar">
					<div class="workspace-search workspace-toolbar-search">
						<Search className="size-4 text-gray-400" />
						<input
							class="w-full bg-transparent text-sm outline-none"
							bind:value={query}
							placeholder={$i18n.t('Search Notes')}
						/>
					</div>
					<div class="workspace-toolbar-actions">
						<HaloSelect
							bind:value={sortBy}
							options={[
								{ value: 'updated', label: $i18n.t('Recently Updated') },
								{ value: 'created', label: $i18n.t('Recently Created') },
								{ value: 'name', label: $i18n.t('Name') }
							]}
							className="w-fit max-w-full text-xs"
						/>
						<button class="workspace-primary-button" on:click={openCreateModal}>
							<Plus className="size-4" />
							<span>{$i18n.t('Create')}</span>
						</button>
					</div>
				</div>
			</div>
		</section>

		<section class="workspace-section space-y-2">
			{#each filteredItems as note, i}
				<div
					class="flex justify-between items-start w-full px-3 py-3 my-1 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-850 transition group cursor-pointer
					{dropIndex === i && dragIndex !== null && dragIndex !== i ? 'border-t-2 border-blue-400' : ''}"
					draggable="true"
					on:dragstart={() => handleDragStart(i)}
					on:dragover|preventDefault={() => handleDragOver(i)}
					on:drop|preventDefault={handleDrop}
					on:dragend={() => {
						dragIndex = null;
						dropIndex = null;
					}}
					on:click={() => openEditModal(note)}
					on:keypress={() => {}}
					role="button"
					tabindex="0"
				>
					<div class="flex-1 min-w-0">
						<div class="font-medium text-sm truncate" dir="auto">{note.title}</div>
						{#if note.content}
							<div
								class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5 max-w-[400px]"
								dir="auto"
							>
								{note.content.slice(0, 200)}
							</div>
						{/if}
						<div class="flex items-center gap-2 mt-1">
							<span class="text-xs text-gray-400 dark:text-gray-500">
								{formatDate(note.updated_at)}
							</span>
							{#if countChecklist(note.content || '')}
								{@const checks = countChecklist(note.content || '')}
								<span class="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 20 20"
										fill="currentColor"
										class="size-3"
									>
										<path
											fill-rule="evenodd"
											d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
											clip-rule="evenodd"
										/>
									</svg>
									{checks.done}/{checks.all}
								</span>
							{/if}
						</div>
					</div>

					<div class="flex gap-1 items-center opacity-0 group-hover:opacity-100 transition ml-2">
						<Tooltip content={$i18n.t('Copy')}>
							<button
								class="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 transition"
								on:click|stopPropagation={() => handleCopyContent(note)}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-4"
								>
									<path
										d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z"
									/>
									<path
										d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z"
									/>
								</svg>
							</button>
						</Tooltip>
						<Tooltip content={$i18n.t('Delete')}>
							<button
								class="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition"
								on:click|stopPropagation={() => confirmDelete(note.id)}
							>
								<GarbageBin className="size-4" />
							</button>
						</Tooltip>
					</div>
				</div>
			{:else}
				<div class="workspace-empty-state">
					<p class="text-sm text-gray-500 dark:text-gray-400">
						{query
							? $i18n.t('No notes found matching your search')
							: $i18n.t('No notes yet. Create your first note to get started.')}
					</p>
				</div>
			{/each}
		</section>
	</div>
{:else}
	<div class="w-full h-full flex justify-center items-center">
		<Spinner />
	</div>
{/if}

<!-- Note Editor Modal -->
{#if showEditor}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div
			class="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col"
		>
			<div class="flex items-center justify-between px-6 py-4 border-b dark:border-gray-800">
				<div class="flex items-center gap-3">
					<h3 class="text-lg font-semibold">
						{editingNote ? $i18n.t('Edit Note') : $i18n.t('Create Note')}
					</h3>

					{#if activeEditors.length > 0}
						<div class="flex items-center gap-1">
							{#each activeEditors as editor}
								<Tooltip
									content={editor.name +
										$i18n.t(typingUsers.has(editor.id) ? ' (typing...)' : ' (editing)')}
								>
									<div class="relative">
										<img
											src={editor.profile_image_url || '/user.png'}
											alt={editor.name}
											class="size-6 rounded-full ring-2 ring-green-400"
										/>
										{#if typingUsers.has(editor.id)}
											<div
												class="absolute -bottom-0.5 -right-0.5 size-2.5 bg-green-400 rounded-full animate-pulse"
											/>
										{/if}
									</div>
								</Tooltip>
							{/each}
						</div>
					{/if}
				</div>
				<button
					class="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
					on:click={closeEditor}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="size-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<path d="M18 6L6 18M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
				<div class="flex items-center gap-2">
					<input
						dir="auto"
						class="flex-1 text-xl font-semibold bg-transparent outline-none placeholder:text-gray-400"
						bind:value={noteForm.title}
						placeholder={$i18n.t('Note title...')}
					/>
					<Tooltip content={$i18n.t('Generate title with AI')}>
						<button
							class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition shrink-0"
							disabled={generatingTitle}
							on:click={handleGenerateTitle}
						>
							{#if generatingTitle}
								<Spinner className="size-4" />
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-4"
								>
									<path
										d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.683a1 1 0 01.633.633l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684zM13.949 13.684a1 1 0 00-1.898 0l-.184.551a1 1 0 01-.632.633l-.551.183a1 1 0 000 1.898l.551.183a1 1 0 01.633.633l.183.551a1 1 0 001.898 0l.184-.551a1 1 0 01.632-.633l.551-.183a1 1 0 000-1.898l-.551-.184a1 1 0 01-.633-.632l-.183-.551z"
									/>
								</svg>
							{/if}
						</button>
					</Tooltip>
				</div>

				<div class="flex-1 relative">
					<!-- Toolbar -->
					<div class="flex items-center gap-1 mb-2 pb-2 border-b dark:border-gray-800">
						<Tooltip content={$i18n.t('Insert checklist')}>
							<button
								class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
								on:click={insertChecklist}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-4"
								>
									<path
										fill-rule="evenodd"
										d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</Tooltip>

						<Tooltip content={$i18n.t('Insert image')}>
							<button
								class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
								disabled={uploadingImage}
								on:click={() => imageInput?.click()}
							>
								{#if uploadingImage}
									<Spinner className="size-4" />
								{:else}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 20 20"
										fill="currentColor"
										class="size-4"
									>
										<path
											fill-rule="evenodd"
											d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-1.91 1.909-4.97-4.969a.75.75 0 00-1.06 0L2.5 11.06zm10-3.56a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z"
											clip-rule="evenodd"
										/>
									</svg>
								{/if}
							</button>
						</Tooltip>

						<div class="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />

						<Tooltip content={$i18n.t('Undo') + ' (Ctrl+Z)'}>
							<button
								class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition
									{undoStack.length > 0
									? 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
									: 'text-gray-300 dark:text-gray-700 cursor-not-allowed'}"
								disabled={undoStack.length === 0}
								on:click={handleUndo}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-4"
								>
									<path
										fill-rule="evenodd"
										d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</Tooltip>

						<Tooltip content={$i18n.t('Redo') + ' (Ctrl+Shift+Z)'}>
							<button
								class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition
									{redoStack.length > 0
									? 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
									: 'text-gray-300 dark:text-gray-700 cursor-not-allowed'}"
								disabled={redoStack.length === 0}
								on:click={handleRedo}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="size-4"
								>
									<path
										fill-rule="evenodd"
										d="M12.207 2.232a.75.75 0 00.025 1.06l4.146 3.958H6.375a5.375 5.375 0 000 10.75H9.25a.75.75 0 000-1.5H6.375a3.875 3.875 0 010-7.75h10.003l-4.146 3.957a.75.75 0 001.036 1.085l5.5-5.25a.75.75 0 000-1.085l-5.5-5.25a.75.75 0 00-1.06.025z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</Tooltip>
					</div>

					<textarea
						id="note-content-textarea"
						dir="auto"
						class="w-full px-0 py-2 bg-transparent text-sm outline-none min-h-[300px] resize-none"
						bind:value={noteForm.content}
						placeholder={$i18n.t('Start writing...')}
						on:input={() => {
							scheduleSnapshot();
							emitTyping();
						}}
						on:paste={handleImagePaste}
						on:mouseup={checkSelection}
						on:keyup={checkSelection}
						on:blur={() => setTimeout(() => (showFormatMenu = false), 200)}
						on:keydown={(e) => {
							// Undo: Ctrl+Z
							if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
								e.preventDefault();
								handleUndo();
								return;
							}
							// Redo: Ctrl+Shift+Z or Ctrl+Y
							if (
								(e.ctrlKey || e.metaKey) &&
								(e.key === 'Z' || e.key === 'y') &&
								(e.shiftKey || e.key === 'y')
							) {
								e.preventDefault();
								handleRedo();
								return;
							}

							if (e.key === 'Enter') {
								const ta = e.currentTarget;
								const pos = ta.selectionStart;
								const lines = noteForm.content.slice(0, pos).split('\n');
								const currentLine = lines[lines.length - 1];
								const checkMatch = currentLine.match(/^- \[[ x]\] /);
								if (checkMatch) {
									if (currentLine.trim() === '- [ ]' || currentLine.trim() === '- [x]') {
										e.preventDefault();
										const lineStart = pos - currentLine.length;
										noteForm.content =
											noteForm.content.slice(0, lineStart) + noteForm.content.slice(pos);
										requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart));
									} else {
										e.preventDefault();
										const insert = '\n- [ ] ';
										noteForm.content =
											noteForm.content.slice(0, pos) + insert + noteForm.content.slice(pos);
										const newPos = pos + insert.length;
										requestAnimationFrame(() => ta.setSelectionRange(newPos, newPos));
									}
								}
							}
						}}
					></textarea>

					<!-- Floating format menu -->
					{#if showFormatMenu}
						<div
							class="absolute z-10 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-gray-800 dark:bg-gray-700 shadow-lg"
							style="left: {formatMenuX}px; top: {formatMenuY}px; transform: translateX(-50%);"
						>
							<button
								class="px-1.5 py-0.5 text-xs font-bold text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded"
								title="Bold"
								on:mousedown|preventDefault={() => wrapSelection('**', '**')}>B</button
							>
							<button
								class="px-1.5 py-0.5 text-xs italic text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded"
								title="Italic"
								on:mousedown|preventDefault={() => wrapSelection('*', '*')}>I</button
							>
							<button
								class="px-1.5 py-0.5 text-xs font-mono text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded"
								title="Code"
								on:mousedown|preventDefault={() => wrapSelection('`', '`')}>&lt;&gt;</button
							>
							<button
								class="px-1.5 py-0.5 text-xs line-through text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded"
								title="Strikethrough"
								on:mousedown|preventDefault={() => wrapSelection('~~', '~~')}>S</button
							>
							<div class="w-px h-4 bg-gray-600 mx-0.5" />
							<button
								class="px-1.5 py-0.5 text-xs text-white hover:bg-gray-700 dark:hover:bg-gray-600 rounded"
								title="Link"
								on:mousedown|preventDefault={insertLink}
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									fill="currentColor"
									class="size-3.5"
								>
									<path
										fill-rule="evenodd"
										d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z"
										clip-rule="evenodd"
									/>
									<path
										fill-rule="evenodd"
										d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</div>
					{/if}
				</div>
			</div>

			<div class="flex justify-between items-center px-6 py-4 border-t dark:border-gray-800">
				<div class="text-xs text-gray-400 flex items-center gap-2">
					<span>{noteForm.content.length} {$i18n.t('characters')}</span>
					{#if countChecklist(noteForm.content)}
						{@const checks = countChecklist(noteForm.content)}
						<span>{checks.done}/{checks.all} {$i18n.t('tasks')}</span>
					{/if}
					{#if activeEditors.length > 0}
						<span class="text-green-500">
							{activeEditors.length}
							{$i18n.t(activeEditors.length === 1 ? 'editor' : 'editors')}
						</span>
					{/if}
				</div>
				<div class="flex gap-2">
					<button
						class="px-4 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
						on:click={closeEditor}
					>
						{$i18n.t('Cancel')}
					</button>
					<button
						class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
						on:click={saveNote}
					>
						{editingNote ? $i18n.t('Save') : $i18n.t('Create')}
					</button>
				</div>
			</div>
		</div>
	</div>
	<input
		bind:this={imageInput}
		type="file"
		accept="image/*"
		class="hidden"
		on:change={() => {
			if (imageInput?.files?.[0]) handleImageFile(imageInput.files[0]);
			imageInput.value = '';
		}}
	/>
{/if}
