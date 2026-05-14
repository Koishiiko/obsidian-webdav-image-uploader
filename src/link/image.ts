import WebDavImageUploaderPlugin from "../main";
import { AttachmentLink } from "./attachment";
import { TFile } from "obsidian";
import { LinkData, LinkFactory } from "./types";
import { FileType } from "src/utils";

const factory: LinkFactory = {
	create<T extends LinkData>(
		plugin: WebDavImageUploaderPlugin,
		type: FileType,
		data: T,
	) {
		if (type !== "image") {
			return null;
		}
		return new ImageLink(plugin, data);
	},
};
export default factory;

export class ImageLink<T extends LinkData> extends AttachmentLink<T> {
	constructor(plugin: WebDavImageUploaderPlugin, data: T) {
		super(plugin, data);
	}

	async upload(note: TFile) {
		const uploadInfo = await super.upload(note);
		return {
			fileName: uploadInfo.fileName ?? "",
			url: uploadInfo.url,
			markdownLink: `![${uploadInfo.fileName}](${uploadInfo.url})`,
		};
	}

	async download(note: TFile) {
		const info = await super.download(note);

		if (!info.markdownLink.startsWith("!")) {
			info.markdownLink = `!${info.markdownLink}`;
		}

		return info;
	}
}
