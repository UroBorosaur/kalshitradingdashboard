import "server-only";

import {
  createKalshiOrderGroup,
  getKalshiOrderGroups,
  resetKalshiOrderGroup,
  triggerKalshiOrderGroup,
  updateKalshiOrderGroupLimit,
} from "@/lib/prediction/kalshi";
import type { ClusterGuardSpec } from "@/lib/prediction/order-group-rules";
import type { KalshiOrderGroupLite } from "@/lib/prediction/types";
import { loadStorageState, saveStorageState, withStorageStateWriter } from "@/lib/storage/jsonl";

const STATE_NAME = "kalshi-order-groups";
const STATE_VERSION = 1;
const BINDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BINDINGS = 2_000;

interface PersistedOrderGroupBinding {
  groupId: string;
  lastContractsLimit: number;
  triggered: boolean;
  updatedAtMs: number;
}

interface OrderGroupBindingState {
  stateVersion: number;
  bindings: Record<string, PersistedOrderGroupBinding>;
}

export interface ClusterGuardResult {
  clusterKey: string;
  orderGroupId?: string;
  contractsLimit: number;
  triggered: boolean;
  warnings: string[];
}

function defaultState(): OrderGroupBindingState {
  return {
    stateVersion: STATE_VERSION,
    bindings: {},
  };
}

function compactState(state: OrderGroupBindingState, nowMs = Date.now()): OrderGroupBindingState {
  const entries = Object.entries(state.bindings)
    .filter(([, value]) => Number.isFinite(value.updatedAtMs) && nowMs - value.updatedAtMs <= BINDING_RETENTION_MS)
    .sort((a, b) => b[1].updatedAtMs - a[1].updatedAtMs)
    .slice(0, MAX_BINDINGS);

  return {
    stateVersion: STATE_VERSION,
    bindings: Object.fromEntries(entries),
  };
}

function normalizeState(raw: unknown): OrderGroupBindingState {
  if (!raw || typeof raw !== "object") return defaultState();
  const candidate = raw as { bindings?: Record<string, PersistedOrderGroupBinding> };
  return compactState({
    stateVersion: STATE_VERSION,
    bindings: candidate.bindings ?? {},
  });
}

async function withOrderGroupState<T>(fn: (state: OrderGroupBindingState) => Promise<T>) {
  return withStorageStateWriter(STATE_NAME, async () => {
    const loaded = await loadStorageState<OrderGroupBindingState>(STATE_NAME, defaultState());
    const state = compactState(normalizeState(loaded));
    const result = await fn(state);
    await saveStorageState(STATE_NAME, compactState(state));
    return result;
  });
}

function existingById(groups: KalshiOrderGroupLite[]) {
  return new Map(groups.map((group) => [group.order_group_id, group] as const));
}

export async function ensureClusterOrderGuards(specs: ClusterGuardSpec[]): Promise<Map<string, ClusterGuardResult>> {
  if (!specs.length) return new Map();

  return withOrderGroupState(async (state) => {
    const existingGroups = existingById(await getKalshiOrderGroups(500).catch(() => []));
    const results = new Map<string, ClusterGuardResult>();

    for (const spec of specs) {
      const warnings: string[] = [];
      const contractsLimit = Math.max(1, Math.floor(spec.contractsLimit));
      const binding = state.bindings[spec.clusterKey];
      const existing = binding ? existingGroups.get(binding.groupId) : undefined;

      if (spec.shouldTrigger) {
        if (binding?.groupId && existing) {
          await triggerKalshiOrderGroup(binding.groupId).catch((error) => {
            warnings.push(`Failed to trigger order-group brake: ${(error as Error).message}`);
          });
          state.bindings[spec.clusterKey] = {
            ...binding,
            triggered: true,
            updatedAtMs: Date.now(),
          };
          results.set(spec.clusterKey, {
            clusterKey: spec.clusterKey,
            orderGroupId: binding.groupId,
            contractsLimit,
            triggered: true,
            warnings,
          });
        } else {
          results.set(spec.clusterKey, {
            clusterKey: spec.clusterKey,
            contractsLimit,
            triggered: true,
            warnings,
          });
        }
        continue;
      }

      let groupId = binding?.groupId;
      if (!groupId || !existing) {
        const created = await createKalshiOrderGroup(contractsLimit);
        groupId = created.order_group_id;
        warnings.push(`Created order-group guard ${groupId} for cluster ${spec.clusterKey}.`);
      } else {
        if (binding.triggered) {
          await resetKalshiOrderGroup(groupId).catch((error) => {
            warnings.push(`Failed to reset order-group guard ${groupId}: ${(error as Error).message}`);
          });
        }
        if (binding.lastContractsLimit !== contractsLimit) {
          await updateKalshiOrderGroupLimit(groupId, contractsLimit).catch((error) => {
            warnings.push(`Failed to update order-group limit ${groupId}: ${(error as Error).message}`);
          });
        }
      }

      state.bindings[spec.clusterKey] = {
        groupId,
        lastContractsLimit: contractsLimit,
        triggered: false,
        updatedAtMs: Date.now(),
      };
      results.set(spec.clusterKey, {
        clusterKey: spec.clusterKey,
        orderGroupId: groupId,
        contractsLimit,
        triggered: false,
        warnings,
      });
    }

    return results;
  });
}
