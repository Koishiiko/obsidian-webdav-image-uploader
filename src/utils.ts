import {
	App,
	Editor,
	MarkdownView,
	Notice,
	moment,
	normalizePath,
} from "obsidian";

// replace {{ key }} and {{ key:format }} with variables
export function formatPath(
	path: string,
	variables: ReturnType<typeof getFormatVariables>,
) {
	const regex = /\{\{\s*(\w+)(?::([^}]+))?\s*\}\}/g;
	const result = path.replace(regex, (match, key, format) => {
		const varKey = key.toLowerCase() as keyof typeof variables;
		const value = variables[varKey];
		if (value == null) {
			return match;
		}

		if (value.type === "string") {
			return value.value as string;
		}

		if (value.type === "date") {
			format = format ?? "YYYY-MM-DD HH:mm:ss";
			return value.value.format(format);
		}

		return match;
	});

	// normalizePath() is always contains no leading `/`
	return "/" + normalizePath(result);
}

export interface NoteInfo {
	basename: string;
	stat: {
		ctime: number;
		mtime: number;
	};
}

export function getFormatVariables(file: File, note: NoteInfo) {
	const [fileName, fileExtension] = file.name.split(".");
	return {
		name: { type: "string", value: fileName },
		ext: { type: "string", value: fileExtension },
		nameext: { type: "string", value: file.name },
		mtime: { type: "date", value: moment(new Date(file.lastModified)) },
		now: { type: "date", value: moment() },
		notename: { type: "string", value: note.basename },
		notectime: { type: "date", value: moment(new Date(note.stat.ctime)) },
		notemtime: { type: "date", value: moment(new Date(note.stat.mtime)) },
	};
}

export type FormatVariables = ReturnType<typeof getFormatVariables>;

export function replaceLink(
	editor: Editor,
	lineNumber: number,
	link: LinkInfo,
	newLink?: string,
) {
	const line = editor.getLine(lineNumber);
	const newLine =
		line.substring(0, link.start) +
		(newLink ?? "") +
		line.substring(link.end);
	editor.setLine(lineNumber, newLine);
}

export function getFileByPath(app: App, path: string) {
	path = decodeURI(path);
	// https://forum.obsidian.md/t/how-to-get-full-paths-from-link-text
	return app.metadataCache.getFirstLinkpathDest(path, "");
}

// get link currently selected
export function getSelectedLink(editor: Editor) {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const links = matchLinks(line);
	return links.find(
		(link) => link.start <= cursor.ch && link.end >= cursor.ch,
	);
}

// get all links in line
export function matchLinks(content: string): LinkInfo[] {
	// !?[$1]($2)|!?[[$3|$4]] - markdown or wikilink
	const regex =
		/(?:!?\[(.*?)\]\((.*?)\))|(?:!?\[\[([^|\]]+?)(?:\|(.*?))?\]\])/g;
	const matches = content.matchAll(regex);
	return (
		Array.from(matches)
			.map((match) => {
				let name: string;
				let path: string;

				if (match[3] != null) {
					path = match[3];
					name = match[4] ?? "";
				} else {
					name = match[1] ?? "";
					path = match[2];
				}

				return {
					start: match.index ?? 0,
					end: (match.index ?? 0) + match[0].length,
					raw: match[0],
					name: name,
					path: path,
				};
			})
			// reverse the order as replacing links from back to front is more convenient
			.reverse()
	);
}

export interface LinkInfo {
	start: number;
	end: number;
	name: string;
	path: string;
	raw: string;
}

export function isLocalPath(path: string) {
	return !path.startsWith("http://") && !path.startsWith("https://");
}

export function noticeError(message: string, ...args: unknown[]) {
	console.error(message, ...args);
	new Notice(message, 5000);
}

export function getToken(username?: string, password?: string) {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	const binString = String.fromCharCode(...bytes);
	return btoa(binString);
}

export function getCurrentEditor(app: App) {
	return app.workspace.getActiveViewOfType(MarkdownView)?.editor;
}

export function getFileType(fileName: string) {
	const index = fileName.lastIndexOf(".");
	if (index === -1) {
		return "attachment";
	}

	const fileExtension = fileName.substring(index + 1);
	if (fileExtension === "md") {
		return "md";
	}

	if (fileExtension === "pdf") {
		return "pdf";
	}

	const imageExtensions = [
		"jpg",
		"jpeg",
		"png",
		"gif",
		"svg",
		"webp",
		"bmp",
		"ico",
	];
	if (imageExtensions.includes(fileExtension)) {
		return "image";
	}

	return "attachment";
}

export type FileType = ReturnType<typeof getFileType>;
