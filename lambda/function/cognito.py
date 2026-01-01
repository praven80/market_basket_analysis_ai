import os
import json
import boto3

cognito = boto3.client('cognito-idp')
secrets = boto3.client('secretsmanager')

CLIENT_ID = os.getenv("COGNITO_CLIENT_ID")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID")
COGNITO_SECRET_ARN = os.getenv("COGNITO_SECRET_ARN")
physical_resource_id = CLIENT_ID


def lambda_handler(event, context):
    print(f"Event received: {json.dumps(event, default=str)}")
    request_type = event['RequestType']
    if request_type == 'Create': return on_create(event)  # noqa
    if request_type == 'Update': return on_update(event)  # noqa
    if request_type == 'Delete': return on_delete(event)  # noqa
    raise Exception("Invalid request type: %s" % request_type)


def on_create(event):
    print(f"Event: {json.dumps(event, default=str)}")
    try:
        response = secrets.get_secret_value(SecretId=COGNITO_SECRET_ARN)
        secret = json.loads(response['SecretString'])
        print(f"Retrieved secrets :: {secret}")
        response = cognito.sign_up(
            ClientId=CLIENT_ID, Username=secret['username'], Password=secret['password'])
        print(f"boto3 response: {json.dumps(response, default=str)}")

        cognito.admin_confirm_sign_up(
            UserPoolId=COGNITO_USER_POOL_ID, Username=secret['username'])
        print("Confirmed signup via admin")
    except Exception as e:
        print(f"Error occurred: {str(e)}")
        raise e
    return {'PhysicalResourceId': physical_resource_id}


def on_update(event):
    return {'PhysicalResourceId': physical_resource_id}


def on_delete(event):
    return {'PhysicalResourceId': physical_resource_id}
