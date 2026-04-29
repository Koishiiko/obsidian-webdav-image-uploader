import {
	Editor,
	Menu,
	Notice,
	Platform,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
} from "obsidian";
import { WebDavClient } from "./webdavClient";
import { createWebDavImageExtension, WebDavImageLoader } from "./imageLoader";
import {
	getCurrentEditor,
	noticeError,
	replaceLink,
	getSelectedLink,
	LinkInfo,
} from "./utils";
import {
	DEFAULT_SETTINGS,
	WebDavImageUploaderSettings,
	WebDavImageUploaderSettingTab,
} from "./settings";
import { BatchDownloader, BatchUploader } from "./batch";
import { ConfirmModal } from "./modals/confirmModal";
import { Link, createLink } from "./link";
import { getRenamePath } from "./modals/renameModal";

export default class WebDavImageUploaderPlugin extends Plugin {
	settings: WebDavImageUploaderSettings;

	client: WebDavClient;

	loader: WebDavImageLoader;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new WebDavImageUploaderSettingTab(this.app, this));

		this.client = new WebDavClient(this);

		this.loader = new WebDavImageLoader(this);

		this.addCommand({
			id: "toggle-auto-upload",
			name: "Toggle auto upload",
			callback: this.toggleAutoUpload.bind(this),
		});

		// upload file when pasted or dropped
		this.registerEvent(
			this.app.workspace.on("editor-paste", this.onUploadFile.bind(this)),
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.onUploadFile.bind(this)),
		);

		// register right click menu items when clicking on image link
		this.registerEvent(
			this.app.workspace.on(
				"editor-menu",
				this.onRightClickLink.bind(this),
			),
		);
		// on mobile platform, obsidian is not trigger `editor-menu` event on right-clicking the url,
		// and trigger `url-menu` event instead
		if (Platform.isMobile) {
			this.registerEvent(
				this.app.workspace.on("url-menu", (menu) =>
					this.onRightClickLink(menu, getCurrentEditor(this.app)!),
				),
			);
		}

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source) => {
				// obsidian is not trigger `editor-menu` event on mobile platform,
				// and only trigger `link-context-menu` event
				if (Platform.isMobile && source === "link-context-menu") {
					return this.onRightClickLink(
						menu,
						getCurrentEditor(this.app)!,
					);
				}

				// register right click menu items in file explorer
				if (source === "file-explorer-context-menu") {
					this.onRightClickExplorer(menu, file);
				}
			}),
		);

		// add basic authentication header when loading webdav images
		if (!this.settings.disableBasicAuth) {
			this.registerEditorExtension(createWebDavImageExtension(this));
		}

		console.log(
			"WebDAV Image Uploader loaded, version:",
			this.manifest.version,
		);
	}

	onunload() {
		this.loader.destroy();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);

		if (this.client != null) {
			this.client.initClient();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.client.initClient();
	}

	async toggleAutoUpload() {
		this.settings.enableUpload = !this.settings.enableUpload;
		await this.saveSettings();
		new Notice(
			`Auto upload is ${
				this.settings.enableUpload ? "enabled" : "disabled"
			}.`,
		);
	}

	async onUploadFile(e: ClipboardEvent | DragEvent, editor: Editor) {
		if (!this.settings.enableUpload) {
			return;
		}

		if (e.defaultPrevented) {
			return;
		}

		let fileList: FileList | undefined;
		if (e.type === "paste") {
			fileList = (e as ClipboardEvent).clipboardData?.files;
		} else if (e.type === "drop") {
			fileList = (e as DragEvent).dataTransfer?.files;
		}

		const files = Array.from(fileList ?? []).filter(
			(f) => !this.isExcludeFile(f.name),
		);

		if (files.length === 0) {
			return;
		}

		e.preventDefault();

		const activeFile = this.app.workspace.getActiveFile()!;
		const isBatch = files.length > 1;
		const notice = isBatch
			? new Notice(`Uploading ${files.length} files... (0/${files.length})`, 0)
			: new Notice(`Uploading file: '${files[0].name}'...`, 0);

		const markdownLinks: string[] = [];
		const errors: string[] = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (isBatch) {
				notice.setMessage(
					`Uploading ${files.length} files... (${i + 1}/${files.length})`,
				);
			}
			try {
				const link = createLink(this, file);
				const fileInfo = await link.upload(activeFile);
				markdownLinks.push(fileInfo.markdownLink);
			} catch (err) {
				errors.push(`'${file.name}': ${err}`);
			}
		}

		notice.hide();

		if (markdownLinks.length > 0) {
			editor.replaceSelection(markdownLinks.join("\n"));
		}

		for (const msg of errors) {
			noticeError(`Failed to upload file ${msg}`);
		}
	}

	onRightClickLink(menu: Menu, editor: Editor) {
		const selectedLink = getSelectedLink(editor);
		if (selectedLink == null) {
			return;
		}

		// BUG: menu events can't running asynchronously (see: https://forum.obsidian.md/t/menu-additem-support-asynchronous-callback-functions/52870)
		// so we can't get the actual link info if it needs to be initialized by async function
		// for example, we can not check whether it is a dummy pdf or normal pdf when right-clicking a local `.pdf` link
		// since it needs to read the file content
		// for now, it always shows both upload and download items, and throws the error when actually processing
		const link = createLink(this, selectedLink);

		const lineNumber = editor.getCursor().line;
		if (link.downloadable()) {
			menu.addItem((item) =>
				item
					.setTitle("Download file from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() =>
						this.onDownloadFile(lineNumber, link, editor),
					),
			);

			menu.addItem((item) =>
				item
					.setTitle("Delete file from WebDAV")
					.setIcon("trash")
					.onClick(() => this.onDeleteFile(lineNumber, link, editor)),
			);

			menu.addItem((item) =>
				item
					.setTitle("Rename file from WebDAV")
					.setIcon("pencil-line")
					.onClick(() => this.onRenameFile(lineNumber, link, editor)),
			);
		}

		if (link.uploadable()) {
			menu.addItem((item) =>
				item
					.setTitle("Upload file to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() =>
						this.onUploadLocalFile(lineNumber, link, editor),
					),
			);
		}
	}

	async onRightClickExplorer(menu: Menu, file: TAbstractFile) {
		const modal = new ConfirmModal(this.app, {
			title: "Warning",
			content:
				"The following operations may break your vault. Please make sure to back up your vault before proceeding, are you sure to continue?",
		});

		if (file instanceof TFile && file.extension === "md") {
			menu.addItem((item) =>
				item
					.setTitle("Upload files in note to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadNoteFiles(file, true);
							await uploader.createLog();
						};
						modal.open();
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle("Download files in note from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const downloader = new BatchDownloader(this);
							await downloader.downloadNoteFiles(file);
							await downloader.createLog();
						};
						modal.open();
					}),
			);
		}

		if (file instanceof TFolder) {
			menu.addItem((item) =>
				item
					.setTitle("Upload attachments to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadAttachments(file);
							await uploader.createLog();
						};
						modal.open();
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle("Upload files in folder's notes to WebDAV")
					.setIcon("arrow-up-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const uploader = new BatchUploader(this);
							await uploader.uploadFolderFiles(file);
							await uploader.createLog();
						};
						modal.open();
					}),
			);
			menu.addItem((item) =>
				item
					.setTitle("Download files in folder's notes from WebDAV")
					.setIcon("arrow-down-from-line")
					.onClick(() => {
						modal.onSubmit = async () => {
							const downloader = new BatchDownloader(this);
							await downloader.downloadFolderFiles(file);
							await downloader.createLog();
						};
						modal.open();
					}),
			);
		}
	}

	async onDownloadFile(
		lineNumber: number,
		link: Link<LinkInfo>,
		editor: Editor,
	) {
		await link.init();
		const linkInfo = link.data;

		const notice = new Notice(`Downloading file '${linkInfo.path}'...`, 0);
		try {
			const activeFile = this.app.workspace.getActiveFile()!;
			const newLink = await link.download(activeFile);
			replaceLink(editor, lineNumber, linkInfo, newLink.markdownLink);
		} catch (e) {
			noticeError(`Failed to download '${linkInfo.path}', ${e}`);
		}

		notice.hide();
	}

	async onUploadLocalFile(
		lineNumber: number,
		link: Link<LinkInfo>,
		editor: Editor,
	) {
		await link.init();
		const linkInfo = link.data;

		const notice = new Notice(`Uploading file '${linkInfo.path}'...`, 0);
		try {
			const activeFile = this.app.workspace.getActiveFile()!;
			const fileInfo = await link.upload(activeFile);

			await this.deleteLocalFile(link.getTFile());

			replaceLink(editor, lineNumber, linkInfo, fileInfo.markdownLink);

			new Notice(`File '${linkInfo.path}' uploaded successfully.`);
		} catch (e) {
			noticeError(`Failed to upload file '${linkInfo.path}', ${e}`);
		}

		notice.hide();
	}

	async onRenameFile(
		lineNumber: number,
		link: Link<LinkInfo>,
		editor: Editor,
	) {
		await link.init();
		const linkInfo = link.data;

		const oldPath = this.client.getPath(linkInfo.path);
		const newPath = await getRenamePath(this.app, oldPath);
		if (newPath == null) {
			return;
		}

		const notice = new Notice(
			`Renaming file '${linkInfo.path}' to '${newPath}'...`,
			0,
		);

		try {
			const activeFile = this.app.workspace.getActiveFile()!;
			const newUrl = await link.rename(activeFile, newPath);
			const markdownLink = linkInfo.raw.replace(linkInfo.path, newUrl);

			replaceLink(editor, lineNumber, linkInfo, markdownLink);

			new Notice(`File rename successfully.`);
		} catch (e) {
			noticeError(`Failed to rename file '${linkInfo.path}', ${e}`);
		}

		notice.hide();
	}

	async onDeleteFile(
		lineNumber: number,
		link: Link<LinkInfo>,
		editor: Editor,
	) {
		await link.init();
		const linkInfo = link.data;

		const notice = new Notice(`Deleting file '${linkInfo.path}'...`, 0);
		try {
			const activeFile = this.app.workspace.getActiveFile()!;
			await link.delete(activeFile);
			replaceLink(editor, lineNumber, linkInfo);
		} catch (e) {
			noticeError(`Failed to delete file '${linkInfo.path}', ${e}`);
		}

		notice.hide();
	}

	async deleteLocalFile(file: TFile) {
		const operation = this.settings.uploadedFileOperation;
		if (operation === "default") {
			await this.app.fileManager.trashFile(file);
		} else if (operation === "delete") {
			await this.app.vault.delete(file);
		}
	}

	isWebdavUrl(url: string) {
		return url.startsWith(this.settings.url);
	}

	isExcludeFile(path: string) {
		const extension = path.split(".").pop()?.toLowerCase();
		if (extension == null) {
			return false;
		}
		return !this.settings.includeExtensions.includes(extension);
	}
}
