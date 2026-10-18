import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { linkConfigured, type LinkPage, type LinkProvider } from "@/lib/connectors/link";

const LINKS: { provider: LinkProvider; title: string }[] = [
  { provider: "slack", title: "Slack" },
  { provider: "github", title: "GitHub" },
];

const LINK_RESULTS: Record<string, string> = {
  linked: "Linked. Your activity from that account now counts as yours.",
  "already linked": "That account was already linked to you.",
  taken: "That account is linked to another member. Ask an Admin.",
  failed: "Linking failed. Try again.",
  cancelled: "Linking was cancelled.",
};

export function LinkAccountButtons({
  slug,
  linked,
  from,
  result,
}: {
  slug: string;
  linked: string[];
  from: LinkPage;
  result?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {result && LINK_RESULTS[result] && <p className="text-secondary-foreground text-sm">{LINK_RESULTS[result]}</p>}
      {LINKS.filter(({ provider }) => linkConfigured(provider)).map(({ provider, title }) => {
        const done = linked.some((key) => key.startsWith(`${provider}:`));
        const href = `/api/connectors/${provider}/link?workspace=${slug}&from=${from}`;
        return (
          <div key={provider} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm">{title}</span>
              <Badge variant={done ? "valid" : "muted"}>{done ? "Linked" : "Not linked"}</Badge>
            </div>
            <Button variant={done ? "secondary" : "brand"} size={done ? "sm" : "default"} shape="pill" asChild>
              <a href={href}>{done ? "Link another account" : `Link ${title}`}</a>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
