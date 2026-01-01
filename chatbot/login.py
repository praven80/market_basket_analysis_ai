import streamlit as st
import os
import boto3
from botocore.exceptions import ClientError

if "logged_in" not in st.session_state:
    st.session_state["logged_in"] = False

if "user_name" not in st.session_state:
    st.session_state["user_name"] = ""

# Initialize Boto3 Cognito client
cognito_client = boto3.client('cognito-idp')
secrets_client = boto3.client('secretsmanager')

CLIENT_ID = os.getenv("CLIENT_ID")
#CLIENT_ID = "7dgmhf6uv44pas9ts764p9cj8r"
#CLIENT_ID = "36b86nl7dgom8enen38apam8d9"

COGNITO_SECRET_ARN = os.getenv("COGNITO_SECRET_ARN")


# Set up the Streamlit page
def setup_page():
    st.set_page_config(page_title="Market Basket Analysis Chatbot", page_icon=":rocket:", layout='wide')
    st.image('https://upload.wikimedia.org/wikipedia/commons/9/93/Amazon_Web_Services_Logo.svg', width=200)

    # Display header
    col1, col2 = st.columns([30, 5])
    with col1:
        st.header("Chewy - Market Basket Analysis")

    st.write("-----")

def authenticate_user(username, password):
    try:
        # Authenticate user
        auth_response = cognito_client.initiate_auth(
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password
            },
            ClientId=CLIENT_ID
        )
        # Authentication successful
        return auth_response['AuthenticationResult']['AccessToken']
    except ClientError as e:
        # Authentication failed
        st.error(f"Authentication failed: {e.response['Error']['Message']}")
        return None


def main():
    setup_page()
    st.write("Please enter your credentials to login.")

    with st.form("login_form"):
        username = st.text_input("Username")
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Login")

    if submitted:
        access_token = authenticate_user(username, password)
        if access_token:
            st.session_state["logged_in"] = True
            st.session_state["user_name"] = username

            st.success("Authentication successful!")
            #redirect_to_page("market_basket_analysis")
            st.switch_page("pages/market_basket_analysis.py")
        else:
            #set_authentication(False)
            user_state._authentication = False
            st.error("Authentication failed. Please try again.")

# Function to redirect to another page
def redirect_to_page(page_name):
    st.markdown(
        f'<meta http-equiv="refresh" content="0;URL={page_name}">',
        unsafe_allow_html=True)


if __name__ == "__main__":
    main()
