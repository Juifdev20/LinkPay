import { Loader2, Mail, MessageCircle, Phone } from 'lucide-react';
import { useSupportContacts, whatsappLink } from '@/lib/support';
import { cn } from '@/lib/utils';

/** The support contacts as tappable lines (call, WhatsApp, email) — set by the super admin, never written in the code. */
/** `quiet`: nothing at all while loading or when no contact is set (screens where it's only an extra). */
export function SupportContactList({ className, quiet }: { className?: string; quiet?: boolean }) {
  const { support, isLoading } = useSupportContacts();
  if (isLoading) return quiet ? null : <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />;

  const lines = [
    support.phone && { icon: Phone, label: 'Appeler', value: support.phone, href: `tel:${support.phone.replace(/\s/g, '')}` },
    support.whatsapp && { icon: MessageCircle, label: 'WhatsApp', value: support.whatsapp, href: whatsappLink(support.whatsapp) },
    support.email && { icon: Mail, label: 'Email', value: support.email, href: `mailto:${support.email}` },
  ].filter(Boolean) as { icon: typeof Phone; label: string; value: string; href: string }[];

  if (!lines.length) {
    if (quiet) return null;
    return <p className={cn('text-sm text-muted-foreground', className)}>Les contacts du support seront bientôt disponibles ici.</p>;
  }
  return (
    <div className={cn('space-y-2', className)}>
      {lines.map(({ icon: Icon, label, value, href }) => (
        <a
          key={label}
          href={href}
          target={href.startsWith('https:') ? '_blank' : undefined}
          rel="noreferrer"
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm hover:bg-accent"
        >
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-muted-foreground">{label}</span>
          <span className="ml-auto font-medium text-foreground">{value}</span>
        </a>
      ))}
    </div>
  );
}
