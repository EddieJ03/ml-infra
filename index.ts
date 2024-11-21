import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as azure from "@pulumi/azure-native";
import * as k8s from "@pulumi/kubernetes";
// import BlobServiceAccount from "./BlobServiceServiceAccount";
import TraefikRoute from "./TraefikRoute";

// Create Resource Group
const resourceGroup = new azure.resources.ResourceGroup("mlplatform-rg");

// Generate random password for PostgreSQL
const mlflowDBPassword = new random.RandomPassword("mlflow-db-password", {
  length: 16,
  special: false,
});

// Create PostgreSQL server
const mlflowDBServer = new azure.dbforpostgresql.Server("mldbserver", {
  resourceGroupName: resourceGroup.name,
  location: "centralus",
  version: "15",
  administratorLogin: "postgres",
  administratorLoginPassword: mlflowDBPassword.result,
  backup: {
    backupRetentionDays: 7,
  },
  sku: {
    tier: "Burstable",
    name: "Standard_B1ms",
  },
  storage: {
    storageSizeGB: 32,
  },
});

// Create PostgreSQL database
const database = new azure.dbforpostgresql.Database(
  "mlflowDB",
  {
    resourceGroupName: resourceGroup.name,
    serverName: mlflowDBServer.name,
    charset: "UTF8",
    collation: "en_US.utf8",
    databaseName: "mlflowDB",
  },
  { dependsOn: [mlflowDBServer] }
);

// Create AKS cluster
const cluster = new azure.containerservice.ManagedCluster("mlplatform-k8s", {
  resourceGroupName: resourceGroup.name,
  dnsPrefix: "mlplatform",
  identity: {
    type: "SystemAssigned",
  },
  agentPoolProfiles: [
    {
      name: "agentpool",
      count: 2,
      vmSize: "standard_b2s",
      mode: "System",
      maxPods: 110,
      osType: "Linux",
      type: "VirtualMachineScaleSets",
      // Enable autoscaling
      enableAutoScaling: true,
      minCount: 1,
      maxCount: 5,
    },
  ],
  networkProfile: {
    networkPlugin: "azure",
    loadBalancerSku: "standard",
  },
});

const aksPostgresFirewallRule = new azure.dbforpostgresql.FirewallRule(
  "aks-postgres",
  {
    resourceGroupName: resourceGroup.name,
    serverName: mlflowDBServer.name,
    startIpAddress: "0.0.0.0",
    endIpAddress: "255.255.255.255",
  }
);

const storageAccount = new azure.storage.StorageAccount("ml-storage", {
  accountName: "mlinfrastorage",
  allowBlobPublicAccess: false,
  allowSharedKeyAccess: true,
  defaultToOAuthAuthentication: false,
  encryption: {
    keySource: azure.storage.KeySource.Microsoft_Storage,
    requireInfrastructureEncryption: false,
    services: {
      blob: {
        enabled: true,
        keyType: azure.storage.KeyType.Account,
      },
      file: {
        enabled: true,
        keyType: azure.storage.KeyType.Account,
      },
    },
  },
  keyPolicy: {
    keyExpirationPeriodInDays: 20,
  },
  kind: azure.storage.Kind.Storage,
  location: "westus",
  resourceGroupName: resourceGroup.name,
  sasPolicy: {
    expirationAction: azure.storage.ExpirationAction.Log,
    sasExpirationPeriod: "1.15:59:59",
  },
  sku: {
    name: azure.storage.SkuName.Standard_GRS,
  },
});

// blob container resource
const blobContainer = new azure.storage.BlobContainer("artifact-storage", {
  accountName: storageAccount.name,
  defaultEncryptionScope: "encryptionscope185",
  denyEncryptionScopeOverride: true,
  resourceGroupName: resourceGroup.name,
});

// Retrieve the Storage Account Keys
const storageAccountKeys = pulumi
  .all([resourceGroup.name, storageAccount.name])
  .apply(([rgName, saName]) =>
    azure.storage.listStorageAccountKeys({
      resourceGroupName: rgName,
      accountName: saName,
    })
  );

// Export the kubeconfig
export const kubeconfig = pulumi
  .all([resourceGroup.name, cluster.name])
  .apply(([resourceGroupName, clusterName]) =>
    pulumi.secret(
      azure.containerservice
        .listManagedClusterUserCredentials({
          resourceGroupName: resourceGroupName,
          resourceName: clusterName,
        })
        .then(
          (
            credentials: azure.containerservice.ListManagedClusterUserCredentialsResult
          ) => {
            const encoded = credentials?.kubeconfigs?.[0]?.value ?? "";
            return Buffer.from(encoded, "base64").toString();
          }
        )
        .catch((err) => console.error(err))
    )
  );

// Export the primary key
export const primaryStorageKey = storageAccountKeys.keys[0].value;

const k8sprovider = new k8s.Provider("k8s-provider", {
  kubeconfig: kubeconfig,
});

/**
 * 
 * MLFlow container on AKS
 * 
 */
const mlflow = new k8s.helm.v3.Chart(
  "mlflow",
  {
    chart: "mlflow",
    fetchOpts: { repo: "https://larribas.me/helm-charts" },
    values: {
      backendStore: {
        postgres: {
          enabled: true,
          host: mlflowDBServer.fullyQualifiedDomainName,
          port: 5432,
          database: database.name,
          username: "postgres",
          password: mlflowDBPassword.result,
        },
      },
      defaultArtifactRoot: pulumi.interpolate`https://mlinfrastorage.blob.core.windows.net/artifact-storage`,
    },
  },
  {
    provider: k8sprovider,
  }
);

/**
 * 
 * Setting up Traefik and route for /mlflow
 * 
 */
const traefik = new k8s.helm.v3.Chart(
  "traefik",
  {
    chart: "traefik",
    fetchOpts: { repo: "https://helm.traefik.io/traefik" },
  },
  {
    provider: k8sprovider,
  }
);

new TraefikRoute(
  "mlflow-traefik-route",
  {
    prefix: "/mlflow",
    service: mlflow.getResource("v1/Service", "mlflow"),
    namespace: "default",
  },
  { provider: k8sprovider }
);

/**
 * 
 * Setting up DNS Zone + A Record
 * Helpful Link: https://learn.microsoft.com/en-us/azure/dns/dns-getstarted-portal
 * To find IP of Traefik load balancer, go to your Pulumi stack, go to dev, under resources, and look for traefik core:Service, then scroll down
 * 
 */




// const mlflowNamespace = new k8s.core.v1.Namespace('mlflow-namespace', {
//   metadata: { name: 'mlflow' },
// }, { provider: k8sprovider });

// const mlflowServiceAccount = new BlobServiceAccount('mlflow-service-account', {
//   namespace: mlflowNamespace.metadata.name,
//   resourceGroupName: resourceGroup.name,
//   storageAccountName: storageAccount.name,
//   containerName: blobContainer.name,
//   readOnly: false,
// }, { provider: k8sprovider });
