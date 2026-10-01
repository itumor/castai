From: Christoph Weber <christoph.weber@siemens.example.com>
Subject: CAST AI node not scaling down after workload shrink

Hi team,

We enabled CAST AI on our EKS cluster in eu-central-1 last week (full mode,
onboarded via Terraform). Upscaling works great, but we have one node that has
been sitting almost empty for over two days and CAST AI never removes it.

The workload on it was scaled from 12 replicas down to 2 on Friday. I expected
the node to be drained and removed within an hour or so.

The only special thing about the remaining pods is that they belong to our
payments service, which has a PodDisruptionBudget with minAvailable: 2. Could
that be related? Is this expected behavior? What do we need to change?

Thanks,
Christoph

;; sim: nodes=1 managed=true pods=1 pdb=true
