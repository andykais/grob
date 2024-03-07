import type { Signal } from "@preact/signals";
import { Handlers, PageProps } from "$fresh/server.ts";

interface GrobSchedulerProps {
  grob_input: string | undefined
}

export const handler: Handlers<GrobSchedulerProps> = {
  GET(req, ctx) {
    const url = new URL(req.url);
    console.log(url.searchParams)
    const grob_input = url.searchParams.get("grob_input") ?? undefined
    // const results = NAMES.filter((name) => name.includes(query));
    return ctx.render({ grob_input });
  },
};


export default function GrobScheduler(props: GrobSchedulerProps) {
  console.log({props})
  return (
    <div class="flex gap-2 w-full">
      <form class="w-full">
        <input
          class="flex w-full"
          type="text"
          name="grob_input"
          placeholder="grob input to match against..."
          // value={props.grob_input} 
          />
      </form>
    </div>
  );
}
