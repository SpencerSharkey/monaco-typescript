/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { LanguageServiceDefaults } from './monaco.contribution';
import type { TypeScriptWorker } from './tsWorker';
import { editor, Uri, IDisposable } from './fillers/monaco-editor-core';

export class WorkerManager {
	private _modeId: string;
	private _defaults: LanguageServiceDefaults;
	private _configChangeListener: IDisposable;
	private _updateExtraLibsToken: number;
	private _extraLibsChangeListener: IDisposable;

	private _worker: editor.MonacoWebWorker<TypeScriptWorker> | null;
	private _client: Promise<TypeScriptWorker> | null;

	constructor(modeId: string, defaults: LanguageServiceDefaults) {
		this._modeId = modeId;
		this._defaults = defaults;
		this._worker = null;
		this._client = null;
		this._configChangeListener = this._defaults.onDidChange(() =>
			this._stopWorker()
		);
		this._updateExtraLibsToken = 0;
		this._extraLibsChangeListener = this._defaults.onDidExtraLibsChange(() =>
			this._updateExtraLibs()
		);
	}

	private _stopWorker(): void {
		if (this._worker) {
			this._worker.dispose();
			this._worker = null;
		}
		this._client = null;
	}

	dispose(): void {
		this._configChangeListener.dispose();
		this._extraLibsChangeListener.dispose();
		this._stopWorker();
	}

	private async _updateExtraLibs(): Promise<void> {
		if (!this._worker) {
			return;
		}
		const myToken = ++this._updateExtraLibsToken;
		const proxy = await this._worker.getProxy();
		if (this._updateExtraLibsToken !== myToken) {
			// avoid multiple calls
			return;
		}
		proxy.updateExtraLibs(this._defaults.getExtraLibs());
	}

	private _getClient(): Promise<TypeScriptWorker> {
		if (!this._client) {
			this._worker = editor.createWebWorker<TypeScriptWorker>({
				// module that exports the create() method and returns a `TypeScriptWorker` instance
				moduleId: 'vs/language/typescript/tsWorker',

				label: this._modeId,

				keepIdleModels: true,

				// passed in to the create() method
				createData: {
					compilerOptions: this._defaults.getCompilerOptions(),
					extraLibs: this._defaults.getExtraLibs(),
					customWorkerPath: this._defaults.workerOptions.customWorkerPath
				}
			});

			let p = <Promise<TypeScriptWorker>>this._worker.getProxy();

			if (this._defaults.getEagerModelSync()) {
				p = p.then((worker) => {
					if (this._worker) {
						return this._worker.withSyncedResources(
							editor
								.getModels()
								.filter((model) => model.getModeId() === this._modeId)
								.map((model) => model.uri)
						);
					}
					return worker;
				});
			}

			this._client = p;
		}

		return this._client;
	}

	getLanguageServiceWorker(...resources: Uri[]): Promise<TypeScriptWorker> {
		let _client: TypeScriptWorker;
		return this._getClient()
			.then((client) => {
				_client = client;
			})
			.then((_) => {
				if (this._worker) {
					return this._worker.withSyncedResources(resources);
				}
			})
			.then((_) => _client);
	}
}
