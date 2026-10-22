import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type SupportContacts = { phone: string | null; whatsapp: string | null; email: string | null };

/** The support contacts the super admin set (Paramètres); null fields are not shown. Public: readable before login. */
export function useSupportContacts() {
  const { data, isLoading } = useQuery<{ support?: SupportContacts }>({
    queryKey: ['platform-settings-public'],
    queryFn: async () => (await api.get('/platform/settings')).data,
    staleTime: 10 * 60_000,
  });
  return { support: data?.support ?? { phone: null, whatsapp: null, email: null }, isLoading };
}

/** wa.me wants the international number, digits only: "0812345678" → "243812345678". */
export function whatsappLink(number: string) {
  let digits = number.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `243${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}
