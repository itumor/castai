From: Reinwardt, Gerolf (SI GSW R&D DC IQS) <gerolf.reinwardt@siemens.com>
To: Lubenski, Dimitri (IT IPS TE) <dimitri.lubenski@siemens.com>; Marko Markovic <marko@cast.ai>; Corak, Bosko (IT IPS SEO PCE) <bosko.corak@siemens.com>
Cc: Gavrila, Andrei (FT D EU RO EMSYS HW1) <andrei.gavrila@siemens.com>; Schaffer, Manuel (SI GSW R&D DC IQS) <manuel.schaffer@siemens.com>; Suljic, Ivan (SI GSW R&D DC IQS) <ivan.suljic@siemens.com>; Sauer, Stefan (SI GSW R&D CLO) <stefan.sauer@siemens.com>; Winkler, Marco (SI GSW R&D CLO AS) <marco.winkler@siemens.com>
Subject: RE: Cast.ai Exchange - SI GSW — workshop must move, need next-step keys

(I apology to all but due to Cast.AI expert availability, where are key for next step, we have to move meeting, I tried to find slot fitting to all but as you can imagine hard to find where all people are available in next 7 days. Hopefully you can adjust your agenda for join this meeting)

Dear cast.ai colleagues,

As discussed with Marko and Gerolf we should meet to support SI GSW for cluster optimization as described on points below.

--- forwarded thread ---

From: Reinwardt, Gerolf (SI GSW R&D DC IQS)
Sent: Thursday, September 24, 2026 12:05 PM
Subject: RE: Cast.ai Exchange - SI GSW

Hi Marko, Bosko, Dimitri,

Any news on this? I still got no single feedback on my mails.

From: Reinwardt, Gerolf (SI GSW R&D DC IQS)
Sent: Friday, 11 September 2026 09:16
Subject: RE: Cast.ai Exchange - SI GSW

Hi all,

4 weeks ago, we had our meeting.
What is the state of the issues, we wrote down?

3. Next steps

- Winkler, Marco: Cluster Configuration Analysis: Share the cluster name (immediate EKS) with Ibrahim and the team to enable further analysis and review of the configuration. (Marco) (cluster names are below in the mail)
- Corak, Bosko: Baseline Calculation Clarification: Provide Stefan with the prepared calculation and answer regarding baseline creation and its frequency in highly flexible environments. (Bosko)
- marko@cast.ai: Cluster Efficiency Analysis: Conduct a deeper analysis of the Helios cluster configuration and share findings with Gerolf and the team, including metrics on workload per VCPU before and after autoscaling. (Marko Markovic, Ibrahim, Shahar)
- Corak, Bosko: Cost Savings Dashboard Access: Check and inform Stefan about the nominated FinOps SPOC or Champion from SI who has access to the cost savings cockpit dashboard. (Bosko)
- marko@cast.ai: Workload Autoscaler Consultation: Arrange a technical discussion between Marco and Ibrahim (or another solution architect) to explore workload autoscaler recommendations, GitOps integration, and policy configuration options. (Marco, Ibrahim)
  - How shall this work? Where do you know from, which git repo contains the helm charts etc?
- marko@cast.ai: Anomaly Detection Documentation: Send documentation to Gerolf explaining how to view and interpret detected anomalies in the cluster cost monitoring view. (Ebrahim)
- Gerolf: Workshop Scheduling: Propose potential dates in September for the postponed workshop to discuss optimizations and requirements in detail with SI and Cast AI teams. (Gerolf)

Regarding the Workshop: it is hard to find a half day slot for all of us.
Up to now, we always found a solution together, if there were technical issues. Our main topic is costs, not technical issues.

What we see is that on our big R&D clusters (ngm-helios-eks, ngm-integ-eks) with a lot of dynamics (redeployment, shutdown during night and weekend, ...) the costs for cast are very high (data from august 2026):

| Cluster        | Costs in FinOps | Billable CPUs (cast) | Cast costs (5 EUR)/Month | Summary costs to pay        |
|----------------|-----------------|----------------------|--------------------------|-----------------------------|
| ngm-helios-eks | $27.000         | 1806                 | 1800 * 5 = 9000 EUR      | $27.000 + 9.000 EUR = $37.400 |
| ngm-integ-eks  | $12.500         | 876                  | 880 * 5 = 4400 EUR       | $12.500 + 4.400 EUR = $17.600 |

Currently, I do not see a benefit (cost wise) on our R&D clusters to run cast.AI.
The benefit in R&D I currently see is that we do not need to select node types (as cast does that for us) and that we can run an enforced rebalancer to reduce the number of nodes.

We are currently running a test with a production like system (no dynamics like R&D clusters) including workload autoscaling to compare the costs of such a system. Currently it looks good, but no official numbers without proper data after a couple of weeks (FinOps and Cast.ai).

Based on the fact, that we have to deliver on prem in the future (system will not only run as SaaS but also in the datacenter of a customer without internet access), we need to optimize our workloads (our devs need to do so), so enabling workload autoscaler in R&D has a big drawback for me.

Regards,
Gerolf
