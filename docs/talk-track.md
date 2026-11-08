# Talk track

Two minutes, Mock mode (the made-up sample). Say first: "this is a sample; nothing here is a real environment".

1. **The picture.** "Three boxes: a laptop running Docker and two Kubernetes namespaces, plus the SaaS services they call. Solid lines are links we saw in config or logs; dashed ones are configured but nobody checked traffic."
2. **Click a card.** "The panel lists what is behind it, with replicas, and says where each role came from. 'By name, unverified' means we guessed server or front end from the workload's name."
3. **Switch to After.** "The question: what if Kubernetes held servers only and every front end ran in Docker on the laptop? Cards move. Front ends leave the namespaces; servers that only run locally are listed 'to deploy'; servers sitting at 0 replicas are listed 'to scale up'."
4. **Map tab.** "The same facts as a table: a summary per environment and a 'what lives where' matrix. After shows the plan in the matrix."
5. **Reset layout.** "Drag boxes to tell your story; Reset puts them back."
6. **Real, if you own it.** "With a snapshot from the read-only collector, the Real toggle shows your own machines. Do not share that screen: it names real hosts."

If asked "is After a plan?" - no. It is computed from roles; every guess is labelled, and the lists are what to check first.
