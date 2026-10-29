/**
 * src/components/actions/ActionRegistry.ts
 * Central registry managing active v1 actions and roadmap plugin tabs.
 */

import { ActionPlugin } from '@/types/actions';
import { ChatPlugin } from './ChatPlugin';

export class ActionRegistry {
  private static plugins: Map<string, ActionPlugin> = new Map();

  private static ensureInitialized(): void {
    if (this.plugins.size > 0) return;
    this.register(ChatPlugin);
  }

  public static register(plugin: ActionPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  public static getAll(): ActionPlugin[] {
    this.ensureInitialized();
    return Array.from(this.plugins.values()).sort((a, b) => a.order - b.order);
  }

  public static getActive(): ActionPlugin[] {
    return this.getAll().filter((p) => p.status === 'active');
  }

  public static getRoadmap(): ActionPlugin[] {
    return this.getAll().filter((p) => p.status === 'roadmap');
  }

  public static getById(id: string): ActionPlugin | undefined {
    this.ensureInitialized();
    return this.plugins.get(id);
  }

  public static reset(): void {
    this.plugins.clear();
  }
}
