import {
	EditorView,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import type WebDavImageUploaderPlugin from "./main";
import { requestUrl } from "obsidian";
import { getToken } from "./utils";

const loadingLight =
	"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIgc3Ryb2tlLWRhc2hhcnJheT0iNiwgMzAiPjxhbmltYXRlVHJhbnNmb3JtIGF0dHJpYnV0ZU5hbWU9InRyYW5zZm9ybSIgdHlwZT0icm90YXRlIiBmcm9tPSIwIDEyIDEyIiB0bz0iMzYwIDEyIDEyIiBkdXI9IjFzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIvPjwvY2lyY2xlPjwvc3ZnPg==";
const loadingDark =
	"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIzIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIgc3Ryb2tlLWRhc2hhcnJheT0iNiwgMzAiPjxhbmltYXRlVHJhbnNmb3JtIGF0dHJpYnV0ZU5hbWU9InRyYW5zZm9ybSIgdHlwZT0icm90YXRlIiBmcm9tPSIwIDEyIDEyIiB0bz0iMzYwIDEyIDEyIiBkdXI9IjFzIiByZXBlYXRDb3VudD0iaW5kZWZpbml0ZSIvPjwvY2lyY2xlPjwvc3ZnPg==";

class WebDavImageLoaderExtension implements PluginValue {
	plugin: WebDavImageUploaderPlugin;

	mutationObserver: MutationObserver;

	images: Set<HTMLImageElement>;

	constructor(view: EditorView, plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;

		this.images = new Set();

		this.initMutationObserver(view);
	}

	update(_update: ViewUpdate): void {
		// update() is called very often and it is hard to know when the page is rendered completely,
		// so I think using `MutationObserver` is a better choice
	}

	destroy() {
		this.mutationObserver.disconnect();

		this.images.forEach((el) => {
			void this.plugin.loader.revokeImage(el);
		});
		this.images.clear();
	}

	initMutationObserver(view: EditorView) {
		// handle images that are added in the view
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== "childList") {
					continue;
				}

				mutation.addedNodes.forEach((node) => {
					if (node.nodeName === "IMG") {
						void this.loadImage(node as HTMLImageElement);
					}
				});
			}
		});

		this.mutationObserver.observe(view.dom, {
			childList: true,
			subtree: true,
		});
	}

	async loadImage(el: HTMLImageElement) {
		if (this.images.has(el)) {
			return;
		}

		await this.plugin.loader.loadImage(el, true);

		this.images.add(el);
	}
}

// replace the image src with a blob url to add support for webdav basic auth
export class WebDavImageLoader {
	plugin: WebDavImageUploaderPlugin;

	// key: original url, value: blob url
	blobs: Map<string, string>;

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;
		this.blobs = new Map();
	}

	async loadImage(el: HTMLImageElement, cache: boolean) {
		if (!this.shouldLoadImage(el)) {
			return;
		}

		const url = el.src;
		let blobUrl = this.blobs.get(url);
		if (blobUrl != null) {
			el.src = blobUrl;
			el.setAttribute("loaded", "true");
			return;
		}

		// add loading animation
		const isDarkMode = activeDocument.body.hasClass("theme-dark");
		el.src = isDarkMode ? loadingDark : loadingLight;

		// fetch the image with username and password
		const { username, password } = this.plugin.settings;
		const token = getToken(username, password);
		const resp = await requestUrl({
			url: url,
			method: "GET",
			headers: { Authorization: `Basic ${token}` },
		});
		const blob = new Blob([resp.arrayBuffer]);

		el.src = URL.createObjectURL(blob);
		el.setAttribute("loaded", "true");

		// when scrolling the view, the image will be removed if it is not in the viewport,
		// and re-added when it is in the viewport again,
		// so the loader will cache the blobs and reuse them to avoid creating new blob multiple times if cache is true,
		// otherwise the blob will be free immediately after the image is loaded
		if (cache) {
			this.blobs.set(url, el.src);
		} else {
			el.onload = () => URL.revokeObjectURL(el.src);
		}
	}

	async revokeImage(el: HTMLImageElement) {
		const blobUrl = this.blobs.get(el.src);
		if (blobUrl != null) {
			URL.revokeObjectURL(blobUrl);
			this.blobs.delete(el.src);
		}
	}

	destroy() {
		this.blobs.forEach((blobUrl) => {
			URL.revokeObjectURL(blobUrl);
		});
		this.blobs.clear();
	}

	shouldLoadImage(el: HTMLImageElement) {
		const url = el.src;
		return (
			el.getAttribute("webdav-loaded") !== "true" &&
			url != null &&
			url !== "" &&
			this.plugin.isWebdavUrl(url)
		);
	}
}

export function createWebDavImageExtension(plugin: WebDavImageUploaderPlugin) {
	return ViewPlugin.define(
		(view) => new WebDavImageLoaderExtension(view, plugin),
	);
}
