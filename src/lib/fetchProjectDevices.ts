import type { Device } from '../types';
import { supabase } from './supabase';

const PAGE_SIZE = 1000;

/** Load all device rows for a project (PostgREST default max is 1000 per request). */
export async function fetchProjectDevices(projectId: number): Promise<Device[]> {
  const devices: Device[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order')
      .order('device_name')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const page = data ?? [];
    devices.push(...page);

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return devices;
}
