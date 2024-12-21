# MiniMLPlatform

A quick ML infra project on Azure.

Uses Pulumi, so install that first https://www.pulumi.com/docs/iac/download-install/

Then run `pulumi up --yes --skip-preview` to set up all the defined resources on Azure.
- Feel free to change up the code in `index.ts` to suit your needs. For example, you might want more than 1 agentpool and more than 1 node per agentpool. I am using one for each to save Azure costs.

See previously ran experiments: http://minimlplatform.duckdns.org/mlflow

Train & Deploy your own model from here: https://github.com/EddieJ03/model-template
- Example of models I have created and deployed:
    - https://github.com/EddieJ03/review-predictions-model
    - https://github.com/EddieJ03/translation-model
