import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateDistrictInput, DistrictResponse, UpdateDistrictInput } from '@erp/types';
import { listDistricts, createDistrict, updateDistrict } from '../api/districts-api';

const districtKeys = {
  all: ['districts'] as const,
  list: (activeOnly: boolean) => ['districts', { activeOnly }] as const,
};

export function useDistricts(activeOnly = false) {
  return useQuery({
    queryKey: districtKeys.list(activeOnly),
    queryFn: () => listDistricts(activeOnly),
  });
}

export function useCreateDistrict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDistrictInput) => createDistrict(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: districtKeys.all }),
    meta: {
      successToast: {
        key: 'platform.feedback.districtAdded',
        values: (data) => ({ name: (data as DistrictResponse).name, code: (data as DistrictResponse).code }),
      },
    },
  });
}

export function useUpdateDistrict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateDistrictInput }) =>
      updateDistrict(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: districtKeys.all }),
    meta: {
      successToast: {
        key: 'platform.feedback.districtStatusChanged',
        values: (data) => ({ name: (data as DistrictResponse).name, active: String((data as DistrictResponse).active) }),
      },
    },
  });
}
