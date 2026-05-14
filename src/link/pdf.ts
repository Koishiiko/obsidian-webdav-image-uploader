import { TFile } from "obsidian";
import WebDavImageUploaderPlugin from "../main";
import { AttachmentLink } from "./attachment";
import { LinkData, LinkFactory } from "./types";
import { FileType } from "src/utils";

const factory: LinkFactory = {
	create<T extends LinkData>(
		plugin: WebDavImageUploaderPlugin,
		type: FileType,
		data: T,
	) {
		if (type !== "pdf") {
			return null;
		}

		return new PdfLink(plugin, data);
	},
};
export default factory;

export class PdfLink<T extends LinkData> extends AttachmentLink<T> {
	dummyFile: TFile | null = null;

	// null if not initialized yet
	isDummyPdf?: boolean;

	constructor(plugin: WebDavImageUploaderPlugin, data: T) {
		super(plugin, data);

		if (!this.plugin.settings.enableDummyPdf) {
			this.isDummyPdf = false;
		}
	}

	uploadable() {
		if (!this.plugin.settings.enableDummyPdf) {
			return super.uploadable();
		}

		if (this.linkType === "external") {
			return false;
		}

		if (this.data instanceof File) {
			return true;
		}

		// assume all pdf is uploadable if not initialized
		return this.isDummyPdf == null ? true : !this.isDummyPdf;
	}

	downloadable() {
		if (!this.plugin.settings.enableDummyPdf) {
			return super.downloadable();
		}

		if (this.linkType === "external") {
			return super.downloadable();
		}

		if (this.data instanceof File) {
			return false;
		}

		// assume all pdf is downloadable if not initialized
		return this.isDummyPdf == null ? true : this.isDummyPdf;
	}

	async init() {
		// initialized
		if (this.isDummyPdf != null) {
			return;
		}

		this.isDummyPdf = false;
		if (!this.plugin.settings.enableDummyPdf) {
			return;
		}

		if (this.linkType === "external") {
			return;
		}

		if (this.data instanceof File) {
			this.isDummyPdf = true;
			return;
		}

		this.dummyFile = this.getTFile();
		const content = await this.plugin.app.vault.cachedRead(this.dummyFile);

		// not a dummy pdf
		if (!content.startsWith("http://") && !content.startsWith("https://")) {
			return;
		}

		this.linkType = "external";
		this.data.path = content;
		this.isDummyPdf = true;
	}

	async upload(note: TFile) {
		await this.init();

		if (!this.uploadable()) {
			throw new Error("File is not uploadable");
		}

		if (this.isDummyPdf && this.dummyFile != null) {
			await this.plugin.app.fileManager.trashFile(this.dummyFile);
		}

		if (!this.plugin.settings.enableDummyPdf) {
			return await super.upload(note);
		}

		const fileInfo = await super.upload(note);

		// create dummy pdf file after uploaded
		// see: https://ryotaushio.github.io/obsidian-pdf-plus/external-pdf-files.html
		const filePath =
			await this.plugin.app.fileManager.getAvailablePathForAttachment(
				fileInfo.fileName,
				note.path,
			);
		const file = await this.plugin.app.vault.create(filePath, fileInfo.url);

		let link = this.plugin.app.fileManager.generateMarkdownLink(
			file,
			filePath,
		);

		if (link[0] !== "!") {
			link = "!" + link;
		}

		return {
			fileName: fileInfo.fileName ?? "",
			url: fileInfo.url,
			markdownLink: link,
		};
	}

	async download(note: TFile) {
		await this.init();

		if (!this.downloadable()) {
			throw new Error("File is not downloadable");
		}

		if (this.dummyFile != null) {
			await this.plugin.app.fileManager.trashFile(this.dummyFile);
		}

		const file = await super.download(note);

		if (file.markdownLink[0] !== "!") {
			file.markdownLink = "!" + file.markdownLink;
		}

		return file;
	}

	async rename(note: TFile, newPath: string) {
		await this.init();

		if (!this.downloadable()) {
			throw new Error("File is not downloadable");
		}

		const newUrl = await super.rename(note, newPath);

		if (!this.isDummyPdf || this.dummyFile == null) {
			return newUrl;
		}

		await this.plugin.app.vault.modify(this.dummyFile, newUrl);

		return newUrl;
	}

	async delete(note: TFile) {
		await this.init();

		await super.delete(note);

		if (this.dummyFile != null) {
			await this.plugin.app.fileManager.trashFile(this.dummyFile);
		}
	}
}
