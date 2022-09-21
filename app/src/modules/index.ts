import { router } from '@/router';
import { usePermissionsStore } from '@/stores/permissions';
import { useUserStore } from '@/stores/user';
import RouterPass from '@/utils/router-passthrough';
import { ModuleConfig } from '@directus/shared/types';
import { ShallowRef, shallowRef } from 'vue';

export function getInternalModules(): ModuleConfig[] {
	const modules = import.meta.globEager('./*/index.ts');

	return Object.values(modules).map((module) => module.default);
}

export function registerModules(modules: ModuleConfig[]): {
	registeredModules: ShallowRef<ModuleConfig[]>;
	onHydrateModule: () => Promise<void>;
	onDehydrateModule: () => Promise<void>;
} {
	const registeredModules = shallowRef<ModuleConfig[]>([]);

	const onHydrateModule = async () => {
		const userStore = useUserStore();
		const permissionsStore = usePermissionsStore();

		if (!userStore.currentUser) return;

		registeredModules.value = (
			await Promise.all(
				modules.map(async (module) => {
					if (!module.preRegisterCheck) return module;

					const allowed = await module.preRegisterCheck(userStore.currentUser, permissionsStore.permissions);

					if (allowed) return module;

					return null;
				})
			)
		).filter((module): module is ModuleConfig => module !== null);

		for (const module of registeredModules.value) {
			router.addRoute({
				name: module.id,
				path: `/${module.id}`,
				component: RouterPass,
				children: module.routes,
			});
		}
	};

	const onDehydrateModule = async () => {
		for (const module of modules) {
			router.removeRoute(module.id);
		}

		registeredModules.value = [];
	};

	return { registeredModules, onHydrateModule, onDehydrateModule };
}
