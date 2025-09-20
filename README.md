# MiniMLPlatform

## What is this?
IaC (Infrastructure-as-Code) code to provision resources for a minimalistic ML platform. The resources provisioned are:
- A Postgres database
    - Stores information such as: experiment IDs & names, run metadata (start time, end time, status), logged metrics, etc.
- An Azure Blob Container
    - Stores the actual trained model files & artifacts 
- An Azure Kubernetes Cluster
    - To deploy models for inference 

## How to set up
Install Pulumi first from here: https://www.pulumi.com/docs/iac/download-install/

Then `git clone` this repo, and run `pulumi up --yes --skip-preview` to set up all the defined resources on Azure.
- Feel free to change up the code in `index.ts` to suit your needs. For example, you might want more than 1 agentpool and more than 1 node per agentpool. I am using one for each to save Azure costs.

See previous experiments I ran: http://minimlplatform.duckdns.org/mlflow
- If the link does not work, it is probably because I paused my Kubernetes cluster so I don't go broke

Train & Deploy your own model from here: https://github.com/EddieJ03/model-template
- Example of models I have created and deployed:
    - https://github.com/EddieJ03/review-predictions-model
    - https://github.com/EddieJ03/translation-model
