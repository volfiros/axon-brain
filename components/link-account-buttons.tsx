import { Button } from "@/components/ui/button";
import { linkConfigured, type LinkProvider } from "@/lib/connectors/link";

const LINKS: { provider: LinkProvider; title: string }[] = [
  { provider: "slack", title: "Slack" },
  { provider: "github", title: "GitHub" },
];

export function LinkAccountButtons({ slug, linked }: { slug: string; linked: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {LINKS.filter(({ provider }) => linkConfigured(provider)).map(({ provider, title }) => {
        const done = linked.some((key) => key.startsWith(`${provider}:`));
        return (
          <Button key={provider} variant={done ? "secondary" : "brand"} shape="pill" asChild>
            <a href={`/api/connectors/${provider}/link?workspace=${slug}`}>{done ? `${title} linked, relink` : `Link ${title}`}</a>
          </Button>
        );
      })}
    </div>
  );
}
