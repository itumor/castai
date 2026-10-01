From: Christoph Büchler <christoph.weber@siemens.example.com>
Subject: CAST AI node not scaling down after workload shrink

Hi team,

Our staging autoscaler removed work from a managed node pool but one node
has been stuck for 12 hours. CAST AI marks it as 'deletion blocked', the
workload is a single `payments-batch` deployment with a PodDisruptionBudget
set to minAvailable: 2 while the deployment has only 1 replica. Can you
explain why the node doesn't go away and what to change?

Thanks,
Christoph

;; sim: nodes=1 managed=true pods=1 pdb=true
