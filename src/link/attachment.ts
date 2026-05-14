import { TFile } from "obsidian";
import WebDavImageUploaderPlugin from "../main";
import {
	formatPath,
	getFileByPath,
	getFormatVariables,
	isLocalPath,
	LinkInfo,
} from "../utils";
import { Link, LinkData } from "./types";

export class AttachmentLink<T extends LinkData> implements Link<T> {
	plugin: WebDavImageUploaderPlugin;

	data: T;

	linkType: "local" | "external";

	tFile: TFile | null = null;

	constructor(plugin: WebDavImageUploaderPlugin, data: T) {
		this.plugin = plugin;
		this.data = data;

		if (data instanceof File) {
			this.linkType = "local";
		} else {
			this.linkType = isLocalPath(data.path) ? "local" : "external";
		}
	}

	init(): Promise<void> {
		return Promise.resolve();
	}

	uploadable(): boolean {
		if (this.linkType === "external") {
			return false;
		}

		if (this.data instanceof File) {
			return true;
		}

		return !this.plugin.isExcludeFile(this.data.path);
	}

	downloadable(): boolean {
		if (this.linkType === "local") {
			return false;
		}

		if (this.data instanceof File) {
			return false;
		}

		return this.plugin.isWebdavUrl(this.data.path);
	}

	getTFile() {
		if (this.tFile != null) {
			return this.tFile;
		}

		if (this.data instanceof File) {
			throw new Error("Cannot get TFile from File data");
		}

		if (this.data.path == null) {
			throw new Error(
				`Path is undefined for link with name '${this.data.name}'`,
			);
		}

		this.tFile = getFileByPath(this.plugin.app, this.data.path);
		if (this.tFile == null) {
			throw new Error(`File not found: '${this.data.path}'`);
		}

		return this.tFile;
	}

	async upload(note: TFile) {
		if (!this.uploadable()) {
			throw new Error(
				`Cannot upload '${
					this.data instanceof File ? this.data.name : this.data.path
				}'`,
			);
		}

		let file;
		if (this.data instanceof File) {
			file = this.data;
		} else {
			const tFile = this.getTFile();
			const buffer = await this.plugin.app.vault.readBinary(tFile);
			file = new File([buffer], tFile.name, {
				lastModified: tFile.stat.mtime,
			});
		}

		const vars = getFormatVariables(file, note);
		const path = formatPath(this.plugin.settings.format, vars);
		const fileInfo = await this.plugin.client.uploadFile(file, path);

		return {
			fileName: file.name,
			url: fileInfo.url,
			markdownLink: `[${file.name}](${fileInfo.url})`,
		};
	}

	async download(note: TFile) {
		if (!this.downloadable()) {
			throw new Error("File is not downloadable");
		}

		this.tFile = await this.plugin.client.downloadFile(
			(this.data as LinkInfo).path,
			note.path,
		);

		const markdownLink = this.plugin.app.fileManager.generateMarkdownLink(
			this.tFile,
			this.tFile.path,
		);

		return {
			tFile: this.tFile,
			markdownLink: markdownLink,
		};
	}

	async rename(_note: TFile, newPath: string): Promise<string> {
		if (!this.downloadable()) {
			throw new Error("File can not be renamed.");
		}

		const oldPath = this.plugin.client.getPath(
			(this.data as LinkInfo).path,
		);

		await this.plugin.client.renameFile(oldPath, newPath);

		return this.plugin.client.getUrl(newPath);
	}

	async delete(_note: TFile) {
		if (!this.downloadable()) {
			throw new Error("File is not deletable");
		}
		await this.plugin.client.deleteFile((this.data as LinkInfo).path);
	}
}
