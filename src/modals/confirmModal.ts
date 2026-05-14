import { App, Modal, Setting } from "obsidian";

export interface ConfirmModalSettings {
	title?: string;
	content?: string;
}

export class ConfirmModal extends Modal {
	settings: ConfirmModalSettings;

	onSubmit?: () => void | Promise<void>;
	onCancel?: () => void;

	constructor(app: App, settings: ConfirmModalSettings) {
		super(app);
		this.settings = settings;
	}

	onOpen(): void {
		const { content, title } = this.settings;

		this.titleEl.className = "mod-warning";

		this.setTitle(title ?? "Notice");

		if (content) {
			this.contentEl.createEl("p", { text: content });
		}

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
					if (this.onCancel) {
						this.onCancel();
					}
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Conform")
					.setCta()
					.onClick(() => {
						this.close();
						if (this.onSubmit) {
							void this.onSubmit();
						}
					}),
			);
	}
}
