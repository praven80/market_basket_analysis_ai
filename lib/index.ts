import * as path from 'path';
import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as customresource from "aws-cdk-lib/custom-resources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

export class TexttoSQL extends cdk.Stack {

    private readonly COGNITO_USER = "demo_user"
    private readonly COGNITO_USER_PWD = "Chewy@2024"
    
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // IAM role for Lambda
        const lambdaRole = new iam.Role(this, "LambdaRole", {
            roleName: `${cdk.Stack.of(this).stackName}-custom-resource-lambda-role`,
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, "custom-resource-lambda-policy", "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")
            ],
            inlinePolicies: {
                policy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            sid: "Ec2Describe",
                            effect: iam.Effect.ALLOW,
                            actions: ["ec2:DescribeManagedPrefixLists"],
                            resources: ["*"]
                        })
                    ]
                })
            },
        })

        // Lambda function creating Q application
        const lambdaFunction = new lambda.Function(this, "LambdaFunction", {
            code: lambda.Code.fromAsset(path.join(__dirname, './lambda')),
            handler: "prefix_list.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_12,
            timeout: cdk.Duration.minutes(1),
            role: lambdaRole,
            description: "Custom resource Lambda function",
            functionName: `${cdk.Stack.of(this).stackName}-custom-resource-lambda`,
            logGroup: new logs.LogGroup(this, "LambdaLogGroup", {
                logGroupName: `/aws/lambda/${cdk.Stack.of(this).stackName}-custom-resource-lambda`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
        })

        // create custom resource using lambda function
        const customResourceProvider = new customresource.Provider(this, "CustomResourceProvider", {
            onEventHandler: lambdaFunction,
            logGroup: new logs.LogGroup(this, "CustomResourceLambdaLogs", {
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }),
        })
        const prefixListResponse = new cdk.CustomResource(this, 'CustomResource', { serviceToken: customResourceProvider.serviceToken });
        const prefixList = prefixListResponse.getAttString("PrefixListId")




        // Store username and password n secrets manager
        const cognitoUserSecret = new secretsmanager.Secret(this, 'TemplatedSecret', {
            secretObjectValue: {
                username: cdk.SecretValue.unsafePlainText(this.COGNITO_USER),
                password: cdk.SecretValue.unsafePlainText(this.COGNITO_USER_PWD)
            }
        })

        // Cognito user pool for sign in
        const userPool = new cognito.UserPool(this, "UserPool", {
            signInAliases: {
                username: true
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            userPoolName: `${cdk.Fn.ref("AWS::StackName")}-user-pool`,
            selfSignUpEnabled: true,
        })

        // Cognito app client
        const appClient = userPool.addClient('ApplicationClient', {
            userPoolClientName: `${cdk.Fn.ref("AWS::StackName")}-app-client`,
            authFlows: {
                userPassword: true,
                adminUserPassword: false,
                userSrp: true
            },
            authSessionValidity: cdk.Duration.minutes(3),
            refreshTokenValidity: cdk.Duration.days(30),
            accessTokenValidity: cdk.Duration.minutes(60),
            idTokenValidity: cdk.Duration.minutes(60),
            enableTokenRevocation: true,
            preventUserExistenceErrors: true
        })

        // Create default user in Cognito User pool using Lambda custom resource
        const cognitoUserCreateIamRole = new iam.Role(this, "CognitoUserRole", {
            roleName: `${cdk.Fn.ref("AWS::StackName")}-cognito-user-role`,
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, "cognito-user-create-role-lambda-policy", "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")
            ],
            inlinePolicies: {
                policy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            sid: "CognitoPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: ["cognito-idp:SignUp", "cognito-idp:AdminConfirmSignUp"],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "SecretsManagerPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: ["secretsmanager:GetSecretValue"],
                            resources: ["*"]
                        }),
                    ]
                })
            },
        })

        // Lambda function for creating user in Cognito User Pool
        const cognitoUserCreateLambda = new lambda.Function(this, "CognitoUserCreateLambda", {
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/function')),
            handler: "cognito.lambda_handler",
            runtime: lambda.Runtime.PYTHON_3_12,
            timeout: cdk.Duration.minutes(15),
            role: cognitoUserCreateIamRole,
            description: "Lambda function for creating user in Cognito User Pool",
            functionName: `${cdk.Fn.ref("AWS::StackName")}-cognito-user-lambda`,
            logGroup: new logs.LogGroup(this, "CognitoUserCreateLambdaLogGroup", {
                logGroupName: `/aws/lambda/${cdk.Fn.ref("AWS::StackName")}-cognito-user-lambda`,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
            environment: {
                COGNITO_CLIENT_ID: appClient.userPoolClientId,
                COGNITO_SECRET_ARN: cognitoUserSecret.secretArn,
                COGNITO_USER_POOL_ID: userPool.userPoolId
            },
        })

        // Custom resource
        const cognitoUserCreateCustomResourceProvider = new customresource.Provider(this, "CognitoUserCreateCustomResourceProvider", {
            onEventHandler: cognitoUserCreateLambda,
            logGroup: new logs.LogGroup(this, "CognitoUserCreateCustomResourceProviderLogs", {
                removalPolicy: cdk.RemovalPolicy.DESTROY
            }),
        })
        new cdk.CustomResource(this, 'CognitoUserCreateCR', { serviceToken: cognitoUserCreateCustomResourceProvider.serviceToken });
        
        //const vpc = ec2.Vpc.fromLookup(this, "VPC", {isDefault: true})
        // Refer to the existing VPC by name
        //const vpc = ec2.Vpc.fromLookup(this, 'VPC', {vpcName: 'bedrock-stack/Vpc'});
        
        //Create a new VPC
        const vpc = new ec2.Vpc(this, "Vpc", {
            maxAzs: 3, // Default is all AZs in the region
            cidr: "10.0.0.0/24", // Smaller CIDR block for the VPC
            subnetConfiguration: [
                {
                    cidrMask: 28, // Smaller subnet for public subnet
                    name: 'public-subnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 28, // Smaller subnet for private subnet
                    name: 'private-subnet',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                }
            ],
        });

        // ECS tasks IAM Role
        const ecsTaskIamRole = new iam.Role(this, "EcsTaskRole", {
            roleName: `${cdk.Fn.ref("AWS::StackName")}-ecs-tasks-role`,
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            inlinePolicies: {
                policy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            sid: "SSMMessages",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "ssmmessages:CreateControlChannel",
                                "ssmmessages:CreateDataChannel",
                                "ssmmessages:OpenControlChannel",
                                "ssmmessages:OpenDataChannel",
                                "lakeformation:GetDataAccess",
                                "glue:*",
                                "athena:*",
                                "bedrock:*"
                            ],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "S3Permissions",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "s3:List*",
                                "s3:PutObject",
                                "s3:Get*"
                            ],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "QPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "qbusiness:List*",
                                "qbusiness:ChatSync",
                                "qbusiness:Get*",
                            ],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "DynamoDBPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "dynamodb:PutItem*",
                                "dynamodb:BatchWriteItem*",
                                "dynamodb:GetItem*",
                                "dynamodb:BatchGetItem*",
                                "dynamodb:Query",
                                "dynamodb:Scan",
                                "dynamodb:UpdateItem",
                                "dynamodb:DeleteItem",
                            ],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "KMSPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "kms:Decrypt",
                                "kms:Encrypt",
                                "kms:Describe*",
                                "kms:GenerateDataKey",
                                "kms:List*",
                                "kms:ReEncrypt",
                            ],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "BedrockPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: ["bedrock:InvokeModel"],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "LambdaPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: ["lambda:InvokeFunction"],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "SecretsManagerPermissions",
                            effect: iam.Effect.ALLOW,
                            actions: ["secretsmanager:GetSecretValue"],
                            resources: ["*"]
                        }),
                        new iam.PolicyStatement({
                            sid: "Logs",
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "logs:DescribeLogGroups",
                                "logs:CreateLogStream",
                                "logs:DescribeLogStreams",
                                "logs:PutLogEvents"
                            ],
                            resources: ["*"]
                        })
                    ]
                })
            }
        })

        // Create DynamoDB Table
        const dynamoTable = new cdk.aws_dynamodb.Table(this, 'MarketBasketAnalysisTable', {
            tableName: 'tbl_market_basket_analysis',
            partitionKey: {
                name: 'query_id',
                type: cdk.aws_dynamodb.AttributeType.STRING
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, 
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST
        });

        // ECS cluster hosting Streamlit application
        const cluster = new ecs.Cluster(this, "StreamlitAppCluster", {
            vpc: vpc,
            clusterName: `${cdk.Fn.ref("AWS::StackName")}-ecs`,
            containerInsights: true,
        })

        // Build image and store in ECR
        const image = ecs.ContainerImage.fromAsset(path.join(__dirname, '../chatbot'), {platform: ecr_assets.Platform.LINUX_AMD64})
        const elbSg = new ec2.SecurityGroup(this, "LoadBalancerSecurityGroup", {
            vpc: vpc,
            allowAllOutbound: true,
            description: "Security group for ALB",
        })
        //elbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Enable 80 IPv4 ingress from internet")
        //elbSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80), "Enable 80 IPv6 ingress from internet")
        elbSg.addIngressRule(ec2.Peer.prefixList(prefixList), ec2.Port.tcp(80), "Enable 80 IPv4 ingress from CloudFront")

        const alb = new elb.ApplicationLoadBalancer(this, "ALB", {
            vpc: vpc,
            securityGroup: elbSg,
            internetFacing: true,
            loadBalancerName: `${cdk.Fn.ref("AWS::StackName")}-alb`,
        })

        // Create Fargate service
        const fargate = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "Fargate", {
            cluster: cluster,
            cpu: 2048,
            desiredCount: 1,
            loadBalancer: alb,
            openListener: false,
            assignPublicIp: true,
            taskImageOptions: {
                image: image,
                containerPort: 8501,
                environment: {
                    CLIENT_ID: appClient.userPoolClientId
                },
                taskRole: ecsTaskIamRole
            },
            serviceName: `${cdk.Fn.ref("AWS::StackName")}-fargate1`,
            memoryLimitMiB: 4096,
            publicLoadBalancer: true,
            enableExecuteCommand: true,
            platformVersion: ecs.FargatePlatformVersion.LATEST,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64
            }
        })

        // fargate.targetGroup.configureHealthCheck({path: "/healthz"})

        // Autoscaling task
        const scaling = fargate.service.autoScaleTaskCount({maxCapacity: 3})
        scaling.scaleOnCpuUtilization('Scaling', {
            targetUtilizationPercent: 50,
            scaleInCooldown: cdk.Duration.seconds(60),
            scaleOutCooldown: cdk.Duration.seconds(60)
        })

        new cloudfront.Distribution(this, "Distribution", {
            defaultBehavior: {
                origin: new origins.LoadBalancerV2Origin(alb, {
                    protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
                    customHeaders: {
                        "X-Custom-Header": "random-string"
                    },
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
            },
            comment: `${cdk.Stack.of(this).stackName}-cf-distribution`,            
        })

        fargate.listener.addAction("Action", {
            action: elb.ListenerAction.forward([fargate.targetGroup]),
            conditions: [elb.ListenerCondition.httpHeader("X-Custom-Header", ["random-string"])],
            priority: 1
        })
    }
}

const app = new cdk.App()
const stackName = app.node.tryGetContext('stackName')
//new TexttoSQL(app, "bedrock-stack", {stackName: stackName, env: {account: "307492694773", region: "us-east-1"}})
new TexttoSQL(app, "bedrock-stack", {stackName: stackName, env: {account: "211125668933", region: "us-east-1"}})
