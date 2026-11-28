// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A map of where a team's software runs: a local machine (Docker / OrbStack), Kubernetes namespaces and SaaS services — drawn as a diagram, a per-environment table, and agent flow stacks."
    ]
  },
  {
    heading: "Measured, simulated, UNVERIFIED",
    body: [
      "Mock: a made-up sample (a laptop, two namespaces and two SaaS services). Every name and host in it is fictional. Nothing is read from your machines and nothing is fetched from the network.",
      "Real: a snapshot of your own machines (ENV_MAP_SNAPSHOT), read-only, loopback only. It names real hosts and workloads, so do not share this screen with a customer. The snapshot is what was collected at one moment — the stamp line says when it was taken.",
      "\"After\" is a what-if, not a plan: it is computed from each workload's role. A role guessed from the workload's name is marked \"by name, unverified\". The counts line tells you how many roles were guessed that way."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs across the toolbar: Diagram, Map, Agent flows, Standalone, AI-DEMO2. On Diagram, the Detail group picks Landscape (the high level, one arrow per pair with its link count), Grouped (boxes grouped by role or compose project), or Each running server (one box per running server with the calls between them).",
      "The Today / \"After: Kubernetes for servers only\" group switches between what is measured now and the computed what-if; a notice line explains After whenever it is on. Reset layout re-draws the diagram boxes in their default positions.",
      "The top menu has the Mock/Real mode picker, theme, font size, Talk track, Help and Reset."
    ]
  },
  {
    heading: "If the map is empty or wrong",
    body: [
      "In Real the map is only as good as the snapshot: re-run the collect script and the next request re-reads the file, no restart. If the snapshot does not validate, nothing is drawn and the page lists the problems. Switch to Mock to keep exploring."
    ]
  }
];
