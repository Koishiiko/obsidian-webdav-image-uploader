import { App, Modal, Notice, Setting } from "obsidian";

export async function getRenamePath(app: App, path: string) {
	return new Promise<string | null>((reslove) => {
		const modal = new RenameModal(app, {
			title: "Rename File on WebDAV",
			path: path,
			onConfirm: async (newPath: string) => reslove(newPath),
			onCancel: () => reslove(null),
		});
		modal.open();
	});
}

export interface RenameModalSettings {
	title?: string;
	path: string;
	onCancel?: () => void;
	onConfirm: (newPath: string) => Promise<void>;
}

export class RenameModal extends Modal {
	settings: RenameModalSettings;

	constructor(app: App, settings: RenameModalSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen(): void {
		const { title, path, onCancel, onConfirm } = this.settings;

		let newPath = path;

		this.setTitle(title ?? "Notice");

		const inputEl = this.contentEl.createEl("input", {
			type: "text",
			value: path,
			cls: "webdav-rename-input",
		});
		inputEl.onchange = (e) =>
			(newPath = (e.target as HTMLInputElement).value);

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					if (onCancel) {
						onCancel();
					}
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setCta()
					.onClick(async () => {
						newPath = newPath?.trim() ?? null;
						if (newPath === null || newPath.length === 0) {
							new Notice("New path is empty.");
							return;
						}

						if (newPath === path) {
							new Notice("Path is not modified.");
							return;
						}

						if (onConfirm) {
							await onConfirm(newPath);
							this.close();
						}
					}),
			);
	}
}
