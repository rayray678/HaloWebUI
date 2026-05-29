import { resolveSafeMarkdownUrl } from './html-safety';

type CssValue = string | number | null | undefined;
type ParsedBlock =
	| { type: 'heading'; level: number; text: string }
	| { type: 'paragraph'; text: string }
	| { type: 'list'; ordered: boolean; items: string[] }
	| { type: 'quote'; text: string }
	| { type: 'code'; lang: string; text: string }
	| { type: 'table'; headers: string[]; rows: string[][] };

const THEME = {
	bg: '#f8fafc',
	surface: '#ffffff',
	panel: '#f1f5f9',
	text: '#0f172a',
	muted: '#64748b',
	primary: '#2563eb',
	primarySoft: '#eff6ff',
	accent: '#f59e0b',
	accentSoft: '#fffbeb',
	border: '#cbd5e1',
	borderSubtle: '#e2e8f0',
	codeBg: '#0f172a',
	codeText: '#e2e8f0',
	shadow: '0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.06)'
};

const normalizeText = (value: unknown) =>
	String(value ?? '')
		.replace(/\r\n?|\u2028|\u2029/g, '\n')
		.trim();

const escapeHtml = (value: unknown) =>
	String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');

const escapeAttribute = (value: unknown) => escapeHtml(value).replaceAll('`', '&#096;');

const toStyle = (rules: Record<string, CssValue>) =>
	Object.entries(rules)
		.filter(([, value]) => value !== null && value !== undefined && value !== '')
		.map(([key, value]) => `${key}: ${value}`)
		.join('; ');

const compactHtml = (html: string) =>
	html
		.split('\n')
		.map((line) => line.trim())
		.join('');

const isFence = (line: string) => /^\s*```/.test(line);
const isHeading = (line: string) => /^#{1,4}\s+\S/.test(line);
const isQuote = (line: string) => /^\s*>\s?/.test(line);
const isUnorderedList = (line: string) => /^\s*[-*+]\s+\S/.test(line);
const isOrderedList = (line: string) => /^\s*\d+[.)]\s+\S/.test(line);
const isList = (line: string) => isUnorderedList(line) || isOrderedList(line);
const isTableSeparator = (line: string) =>
	/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const looksLikeTableRow = (line: string) => line.includes('|') && !isFence(line);

const stripTableEdges = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '');
const parseTableRow = (line: string) =>
	stripTableEdges(line)
		.split('|')
		.map((cell) => cell.trim());

const reasoningDetailsBlockPattern =
	/<details\b(?=[^>]*\btype\s*=\s*(?:"reasoning"|'reasoning'|reasoning)(?=[\s>]))[^>]*>[\s\S]*?<\/details>/gi;
const reasoningDetailsOpenPattern =
	/<details\b(?=[^>]*\btype\s*=\s*(?:"reasoning"|'reasoning'|reasoning)(?=[\s>]))[^>]*>/i;

const stripReasoningDetailsFromSegment = (segment: string) => {
	const withoutClosedBlocks = segment.replace(reasoningDetailsBlockPattern, '');
	const lines = withoutClosedBlocks.split('\n');
	const keptLines: string[] = [];
	let skippingReasoningBlock = false;

	for (const line of lines) {
		if (!skippingReasoningBlock && reasoningDetailsOpenPattern.test(line)) {
			skippingReasoningBlock = !/<\/details>/i.test(line);
			continue;
		}

		if (skippingReasoningBlock) {
			if (/<\/details>/i.test(line)) {
				skippingReasoningBlock = false;
			}
			continue;
		}

		keptLines.push(line);
	}

	return keptLines.join('\n');
};

const stripInternalReasoningDetails = (content: string) => {
	const lines = normalizeText(content).split('\n');
	const output: string[] = [];
	let plainSegment: string[] = [];
	let insideFence = false;

	const flushPlainSegment = () => {
		if (plainSegment.length === 0) {
			return;
		}

		output.push(stripReasoningDetailsFromSegment(plainSegment.join('\n')));
		plainSegment = [];
	};

	for (const line of lines) {
		if (isFence(line)) {
			if (!insideFence) {
				flushPlainSegment();
			}

			insideFence = !insideFence;
			output.push(line);
			continue;
		}

		if (insideFence) {
			output.push(line);
		} else {
			plainSegment.push(line);
		}
	}

	flushPlainSegment();

	return normalizeText(output.join('\n'));
};

const renderInlineWithoutLinks = (value: string): string => {
	const input = normalizeText(value);
	let html = '';
	let cursor = 0;
	const codePattern = /`([^`\n]+)`/g;
	let match: RegExpExecArray | null;

	const renderEmphasis = (text: string) =>
		escapeHtml(text)
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/__([^_]+)__/g, '<strong>$1</strong>')
			.replace(/\n+/g, '<br>');

	while ((match = codePattern.exec(input))) {
		html += renderEmphasis(input.slice(cursor, match.index));
		html += `<code style="${escapeAttribute(
			toStyle({
				padding: '1px 5px',
				'border-radius': '6px',
				background: THEME.panel,
				color: THEME.text,
				'font-size': '0.92em'
			})
		)}">${escapeHtml(match[1])}</code>`;
		cursor = match.index + match[0].length;
	}

	html += renderEmphasis(input.slice(cursor));
	return html;
};

const renderInline = (value: string): string => {
	const input = normalizeText(value);
	let html = '';
	let cursor = 0;
	const linkPattern = /\[([^\]\n]{1,200})\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
	let match: RegExpExecArray | null;

	while ((match = linkPattern.exec(input))) {
		html += renderInlineWithoutLinks(input.slice(cursor, match.index));
		const label = match[1];
		const href = resolveSafeMarkdownUrl(match[2], { allowHash: true, allowRelative: false });

		if (href) {
			html += `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer nofollow" style="${escapeAttribute(
				toStyle({ color: THEME.primary, 'text-decoration': 'none', 'font-weight': 600 })
			)}">${renderInlineWithoutLinks(label)}</a>`;
		} else {
			html += renderInlineWithoutLinks(match[0]);
		}

		cursor = match.index + match[0].length;
	}

	html += renderInlineWithoutLinks(input.slice(cursor));
	return html;
};

const parseBlocks = (content: string): ParsedBlock[] => {
	const lines = normalizeText(content).split('\n');
	const blocks: ParsedBlock[] = [];
	let i = 0;

	const readParagraph = () => {
		const paragraph: string[] = [];
		while (i < lines.length) {
			const line = lines[i];
			if (
				!line.trim() ||
				isFence(line) ||
				isHeading(line) ||
				isQuote(line) ||
				isList(line) ||
				(looksLikeTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
			) {
				break;
			}

			paragraph.push(line.trim());
			i += 1;
		}

		if (paragraph.length > 0) {
			blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
		}
	};

	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i += 1;
			continue;
		}

		if (isFence(line)) {
			const lang = line.replace(/^\s*```/, '').trim();
			const code: string[] = [];
			i += 1;
			while (i < lines.length && !isFence(lines[i])) {
				code.push(lines[i]);
				i += 1;
			}
			if (i < lines.length) i += 1;
			blocks.push({ type: 'code', lang, text: code.join('\n') });
			continue;
		}

		if (looksLikeTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
			const headers = parseTableRow(line);
			const rows: string[][] = [];
			i += 2;
			while (i < lines.length && looksLikeTableRow(lines[i]) && lines[i].trim()) {
				rows.push(parseTableRow(lines[i]));
				i += 1;
			}
			blocks.push({ type: 'table', headers, rows });
			continue;
		}

		if (isHeading(line)) {
			const [, marker = '#', text = ''] = /^(#{1,4})\s+(.*)$/.exec(line.trim()) ?? [];
			blocks.push({ type: 'heading', level: marker.length, text });
			i += 1;
			continue;
		}

		if (isQuote(line)) {
			const quote: string[] = [];
			while (i < lines.length && isQuote(lines[i])) {
				quote.push(lines[i].replace(/^\s*>\s?/, '').trim());
				i += 1;
			}
			blocks.push({ type: 'quote', text: quote.join('\n') });
			continue;
		}

		if (isList(line)) {
			const ordered = isOrderedList(line);
			const items: string[] = [];
			while (i < lines.length && (ordered ? isOrderedList(lines[i]) : isUnorderedList(lines[i]))) {
				items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim());
				i += 1;
			}
			blocks.push({ type: 'list', ordered, items });
			continue;
		}

		readParagraph();
	}

	return blocks;
};

const headingFontSize = (level: number) => {
	switch (level) {
		case 1:
			return '22px';
		case 2:
			return '19px';
		case 3:
			return '17px';
		default:
			return '15px';
	}
};

const headingTag = (level: number) => `h${Math.min(Math.max(level + 1, 2), 5)}`;

const renderFlowBlock = (tag: string, inner: string, style: Record<string, CssValue>) =>
	`<${tag} style="${escapeAttribute(toStyle(style))}">${inner}</${tag}>`;

const renderFeatureBlock = (kind: string, inner: string, style: Record<string, CssValue>) =>
	`<div data-halo-block="${escapeAttribute(kind)}" style="${escapeAttribute(toStyle(style))}">${inner}</div>`;

const renderBlock = (block: ParsedBlock) => {
	switch (block.type) {
		case 'heading': {
			const tag = headingTag(block.level);
			return renderFlowBlock(tag, renderInline(block.text), {
				margin: block.level <= 2 ? '18px 0 4px' : '12px 0 2px',
				padding: block.level <= 2 ? '0 0 8px' : 0,
				color: THEME.text,
				'font-size': headingFontSize(block.level),
				'font-weight': 780,
				'line-height': 1.35,
				'letter-spacing': '-0.01em',
				'border-bottom': block.level <= 2 ? `1px solid ${THEME.borderSubtle}` : undefined
			});
		}

		case 'paragraph':
			return renderFlowBlock('p', renderInline(block.text), {
				margin: 0,
				color: THEME.text,
				'font-size': '14.5px',
				'line-height': 1.82
			});

		case 'quote':
			return renderFeatureBlock(
				'quote',
				`<blockquote style="${escapeAttribute(
					toStyle({ margin: 0, color: THEME.text, 'font-size': '14px', 'line-height': 1.78 })
				)}">${renderInline(block.text)}</blockquote>`,
				{
					margin: '4px 0',
					padding: '14px 16px',
					background: `linear-gradient(135deg, ${THEME.accentSoft}, ${THEME.surface})`,
					border: `1px solid ${THEME.borderSubtle}`,
					'border-left': `4px solid ${THEME.accent}`,
					'border-radius': '14px'
				}
			);

		case 'list': {
			const tag = block.ordered ? 'ol' : 'ul';
			const items = block.items
				.map(
					(item) =>
						`<li style="${escapeAttribute(toStyle({ margin: '6px 0', padding: 0 }))}">${renderInline(item)}</li>`
				)
				.join('');

			return renderFlowBlock(tag, items, {
				margin: 0,
				padding: block.ordered ? '0 0 0 24px' : '0 0 0 22px',
				color: THEME.text,
				'font-size': '14.5px',
				'line-height': 1.78
			});
		}

		case 'code':
			return renderFeatureBlock(
				'code',
				`${
					block.lang
						? `<div style="${escapeAttribute(toStyle({ color: THEME.codeText, opacity: 0.76, 'font-size': '12px', padding: '10px 14px 0' }))}">${escapeHtml(block.lang)}</div>`
						: ''
				}<pre style="${escapeAttribute(
					toStyle({
						margin: 0,
						padding: block.lang ? '8px 14px 14px' : '14px',
						overflow: 'auto',
						background: 'transparent',
						color: THEME.codeText,
						'font-size': '13px',
						'line-height': 1.65
					})
				)}"><code>${escapeHtml(block.text)}</code></pre>`,
				{
					margin: '4px 0',
					background: THEME.codeBg,
					'border-radius': '14px',
					overflow: 'hidden',
					'box-shadow': '0 12px 28px rgba(15, 23, 42, 0.12)'
				}
			);

		case 'table': {
			const headers = block.headers
				.map(
					(header) =>
						`<th style="${escapeAttribute(toStyle({ padding: '8px 10px', border: `1px solid ${THEME.borderSubtle}`, background: THEME.primarySoft, color: THEME.text, 'font-size': '12px', 'text-align': 'left' }))}">${renderInline(header)}</th>`
				)
				.join('');
			const rows = block.rows
				.map(
					(row) =>
						`<tr>${row
							.map(
								(cell) =>
									`<td style="${escapeAttribute(toStyle({ padding: '8px 10px', border: `1px solid ${THEME.borderSubtle}`, color: THEME.text, 'font-size': '13px', 'vertical-align': 'top' }))}">${renderInline(cell)}</td>`
							)
							.join('')}</tr>`
				)
				.join('');

			return renderFeatureBlock(
				'table',
				`<div style="${escapeAttribute(toStyle({ overflow: 'auto', 'max-width': '100%' }))}"><table style="${escapeAttribute(toStyle({ width: '100%', 'border-collapse': 'collapse' }))}"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`,
				{
					margin: '4px 0',
					background: THEME.surface,
					border: `1px solid ${THEME.borderSubtle}`,
					'border-radius': '14px',
					overflow: 'hidden',
					'box-shadow': '0 8px 24px rgba(15, 23, 42, 0.05)'
				}
			);
		}
	}
};

export const isKnownInlineHtmlFormatFragment = (content: unknown): content is string =>
	typeof content === 'string' &&
	/(data-html-render-mcp\s*=\s*["']inline["']|data-halo-response-html-format\s*=\s*["']inline["'])/i.test(
		content
	);

export const renderResponseHtmlFormat = (content: string): string => {
	const normalized = stripInternalReasoningDetails(content);
	if (!normalized) {
		return '';
	}

	if (isKnownInlineHtmlFormatFragment(normalized)) {
		return normalized;
	}

	const blocks = parseBlocks(normalized);
	if (blocks.length === 0) {
		return '';
	}

	const body = blocks.map(renderBlock).join('');
	const root = `<div data-halo-response-html-format="inline" style="${escapeAttribute(
		toStyle({
			margin: '8px 0',
			padding: '1px',
			background: `linear-gradient(135deg, ${THEME.primarySoft}, ${THEME.bg} 48%, ${THEME.accentSoft})`,
			color: THEME.text,
			border: `1px solid ${THEME.borderSubtle}`,
			'border-radius': '20px',
			'box-shadow': THEME.shadow,
			'font-family':
				"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
			'line-height': 1.6,
			'max-width': '100%',
			overflow: 'hidden'
		})
	)}"><div style="${escapeAttribute(
		toStyle({
			background: THEME.surface,
			'border-radius': '19px',
			padding: '22px 24px'
		})
	)}"><div style="${escapeAttribute(toStyle({ display: 'flex', 'flex-direction': 'column', gap: '12px' }))}">${body}</div></div></div>`;

	return compactHtml(root);
};
