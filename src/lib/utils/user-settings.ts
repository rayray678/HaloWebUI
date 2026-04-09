import { get } from 'svelte/store';

import { getUserSettings, updateUserSettings, type UserSettingsPayload } from '$lib/apis/users';
import { settings, settingsRevision } from '$lib/stores';

const LEGACY_SETTINGS_STORAGE_KEY = 'settings';

export const clearLegacyUserSettingsCache = () => {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		window.localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY);
	} catch {
		// Ignore storage access failures; settings still load from the backend.
	}
};

export const applyUserSettingsSnapshot = (
	userSettings: UserSettingsPayload | null | undefined,
	fallback: Record<string, any> = {}
) => {
	settings.set((userSettings?.ui ?? fallback) as Parameters<typeof settings.set>[0]);
	settingsRevision.set(userSettings?.revision ?? 0);

	if (userSettings) {
		clearLegacyUserSettingsCache();
	}
};

export const saveUserSettingsPatch = async (token: string, patch: Record<string, any>) => {
	try {
		const nextSettings = await updateUserSettings(token, {
			ui: patch,
			revision: get(settingsRevision)
		});

		applyUserSettingsSnapshot(nextSettings, get(settings) ?? {});
		return nextSettings;
	} catch (error) {
		if ((error as { status?: number })?.status === 409) {
			const latestSettings = await getUserSettings(token).catch(() => null);
			if (latestSettings) {
				applyUserSettingsSnapshot(latestSettings, get(settings) ?? {});
			}
		}

		throw error;
	}
};
