import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as azure from "@pulumi/azure-native";
import * as k8s from "@pulumi/kubernetes";

const nginxIngress = new k8s.helm.v3.Chart("nginx-ingress", {
    path: "./nginx-ingress",
});

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
  location: 'centralus',
  version: "15",
  administratorLogin: "postgres",
  administratorLoginPassword: mlflowDBPassword.result,
  backup: {
      backupRetentionDays: 7,
  },
  // see az postgres flexible-server list-skus --location northeurope
  // see https://learn.microsoft.com/en-us/azure/templates/microsoft.dbforpostgresql/2022-12-01/flexibleservers#sku
  // see https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/
  sku: {
      tier: "Burstable",
      name: "Standard_B1ms", // 2 vCore. 8 GiB RAM.
  },
  storage: {
      storageSizeGB: 32,
  }
});

// Create PostgreSQL database
const database = new azure.dbforpostgresql.Database("mlflowDB", {
  resourceGroupName: resourceGroup.name,
  serverName: mlflowDBServer.name,
  charset: "UTF8",
  collation: "en_US.utf8",
  databaseName: "mlflowDB",
},{ dependsOn: [mlflowDBServer] });


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

// Export connection info
export const postgresqlHost = mlflowDBServer.fullyQualifiedDomainName;
export const postgresqlUsername = pulumi.interpolate`mlflow@${mlflowDBServer.name}`;
export const postgresqlPassword = mlflowDBPassword.result;
export const postgresqlDatabase = database.name;
