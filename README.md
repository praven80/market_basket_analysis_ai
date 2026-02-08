# Text-to-SQL Market Basket Analysis Application

A serverless application that converts natural language questions into SQL queries for market basket analysis, built with AWS CDK, Streamlit, and various AWS services.

You can view a short demo video in the "Demo" folder.

## Architecture Overview

The application uses the following:
- AWS Cognito for authentication
- Amazon ECS (Fargate) for hosting the Streamlit application
- Amazon DynamoDB for storing query history
- Amazon Bedrock for natural language processing
- Amazon Athena for SQL query execution
- AWS Lambda for custom resource management
- Amazon CloudFront for content delivery

## Prerequisites

- AWS Account
- AWS CDK CLI installed
- Python 3.12+
- Node.js 14+
- Docker

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd text-to-sql
```

2. Install dependencies:
```bash
# Install CDK dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt
```

3. Configure AWS credentials:
```bash
aws configure
```

## Deployment

1. Bootstrap CDK (first time only):
```bash
cdk bootstrap
```

2. Deploy the stack:
```bash
cdk deploy
```

## Environment Variables

Required environment variables:
```
CLIENT_ID=<cognito-client-id>
COGNITO_SECRET_ARN=<secret-arn>
```

## Features

- User authentication with Cognito
- Natural language to SQL query conversion
- Interactive query builder
- Real-time query execution
- Query history tracking
- Automatic scaling
- CloudFront distribution

## Development

1. Start the local development server:
```bash
cd chatbot
streamlit run login.py
```

2. Make changes to the CDK stack:
```bash
npm run build
cdk diff
```

3. Run tests:
```bash
npm test
```

## Container Build

```bash
docker build -t text-to-sql .
docker run -p 8501:8501 text-to-sql
```

## Security

- CloudFront distribution with custom header validation
- VPC isolation
- Least privilege IAM roles
- Cognito user authentication
- Secrets management for sensitive data