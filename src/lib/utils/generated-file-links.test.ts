import { describe, expect, it } from 'vitest';

import {
	normalizeGeneratedFileLinkPath,
	resolveGeneratedFileContentUrl,
	resolveGeneratedFileDownloadUrl,
	rewriteGeneratedFileHtmlLinks
} from './generated-file-links';

describe('generated-file-links', () => {
	const files = [
		{
			id: 'file-1',
			name: 'report.pdf',
			path: 'outputs/report.pdf',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-2',
			name: 'notes.txt',
			url: '/api/v1/files/file-2/content?attachment=true',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-5',
			name: 'archive.zip',
			path: 'exports/archive.zip',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-6',
			name: 'workbook.xlsx',
			path: 'exports/workbook.xlsx',
			content_url: '/api/v1/files/file-6/content',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-7',
			name: 'data.bin',
			path: 'artifacts/data.bin',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-4',
			name: 'final report.docx',
			source: 'code_interpreter',
			generated: true
		},
		{
			id: 'file-3',
			name: 'input.pdf',
			source: 'user_upload'
		}
	];

	it('normalizes safe relative file paths without relying on extensions', () => {
		expect(normalizeGeneratedFileLinkPath('./outputs/report.pdf')).toBe('outputs/report.pdf');
		expect(normalizeGeneratedFileLinkPath('archive/data.bin')).toBe('archive/data.bin');
		expect(normalizeGeneratedFileLinkPath('exports/archive.zip')).toBe('exports/archive.zip');
		expect(normalizeGeneratedFileLinkPath('exports/workbook.xlsx')).toBe('exports/workbook.xlsx');
		expect(normalizeGeneratedFileLinkPath('archive\\data.bin')).toBe('archive/data.bin');
		expect(normalizeGeneratedFileLinkPath('notes.txt#preview')).toBe('notes.txt');
	});

	it('rejects absolute, external, and parent-traversal links', () => {
		expect(normalizeGeneratedFileLinkPath('/api/v1/files/file/content')).toBeNull();
		expect(normalizeGeneratedFileLinkPath('https://example.com/report.pdf')).toBeNull();
		expect(normalizeGeneratedFileLinkPath('../report.pdf')).toBeNull();
		expect(normalizeGeneratedFileLinkPath('..\\report.pdf')).toBeNull();
	});

	it('resolves generated files by relative path or basename', () => {
		expect(resolveGeneratedFileDownloadUrl('outputs/report.pdf', files)).toBe(
			'/api/v1/files/file-1/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('report.pdf', files)).toBe(
			'/api/v1/files/file-1/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('./notes.txt', files)).toBe(
			'/api/v1/files/file-2/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('final%20report.docx', files)).toBe(
			'/api/v1/files/file-4/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('exports/archive.zip', files)).toBe(
			'/api/v1/files/file-5/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('exports/workbook.xlsx', files)).toBe(
			'/api/v1/files/file-6/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('artifacts/data.bin', files)).toBe(
			'/api/v1/files/file-7/content?attachment=true'
		);
	});

	it('resolves generated file content urls for embedded media separately from downloads', () => {
		expect(resolveGeneratedFileContentUrl('outputs/report.pdf', files)).toBe(
			'/api/v1/files/file-1/content'
		);
		expect(resolveGeneratedFileContentUrl('exports/workbook.xlsx', files)).toBe(
			'/api/v1/files/file-6/content'
		);
	});

	it('does not resolve unmatched or non-generated files', () => {
		expect(resolveGeneratedFileDownloadUrl('missing.xlsx', files)).toBeNull();
		expect(resolveGeneratedFileDownloadUrl('input.pdf', files)).toBeNull();
		expect(resolveGeneratedFileDownloadUrl('https://example.com/report.pdf', files)).toBeNull();
	});

	it('does not guess a basename when multiple generated files share it', () => {
		const duplicateNameFiles = [
			{
				id: 'file-a',
				name: 'report.pdf',
				path: 'alpha/report.pdf',
				source: 'code_interpreter',
				generated: true
			},
			{
				id: 'file-b',
				name: 'report.pdf',
				path: 'beta/report.pdf',
				source: 'code_interpreter',
				generated: true
			}
		];

		expect(resolveGeneratedFileDownloadUrl('alpha/report.pdf', duplicateNameFiles)).toBe(
			'/api/v1/files/file-a/content?attachment=true'
		);
		expect(resolveGeneratedFileDownloadUrl('report.pdf', duplicateNameFiles)).toBeNull();
	});

	it('does not guess when the same relative path maps to different generated files', () => {
		const duplicatePathFiles = [
			{
				id: 'file-a',
				name: 'report.pdf',
				path: 'outputs/report.pdf',
				source: 'code_interpreter',
				generated: true
			},
			{
				id: 'file-b',
				name: 'report.pdf',
				path: 'outputs/report.pdf',
				source: 'code_interpreter',
				generated: true
			}
		];

		expect(resolveGeneratedFileDownloadUrl('outputs/report.pdf', duplicatePathFiles)).toBeNull();
	});

	it('rewrites generated file links inside sanitized html blocks', () => {
		const html = [
			'<div>',
			'<a href="outputs/report.pdf">PDF</a>',
			'<img src="./notes.txt">',
			'<video src="exports/workbook.xlsx"></video>',
			'<a href="https://example.com/report.pdf">External</a>',
			'<a href="../secret.pdf">Unsafe</a>',
			'</div>'
		].join('');

		const rewritten = rewriteGeneratedFileHtmlLinks(html, files);

		expect(rewritten).toContain('href="/api/v1/files/file-1/content?attachment=true"');
		expect(rewritten).toContain('src="/api/v1/files/file-2/content"');
		expect(rewritten).toContain('src="/api/v1/files/file-6/content"');
		expect(rewritten).toContain('href="https://example.com/report.pdf"');
		expect(rewritten).toContain('href="../secret.pdf"');
		expect(rewritten).not.toContain('href="outputs/report.pdf"');
	});
});
