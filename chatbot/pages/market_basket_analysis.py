import streamlit as st
import boto3
from datetime import datetime
import uuid
import re

from sqlalchemy import create_engine
from langchain_community.utilities.sql_database import SQLDatabase
from langchain_community.chat_models import BedrockChat
from langchain_community.agent_toolkits import create_sql_agent, SQLDatabaseToolkit
from langchain.agents import AgentType
from langchain_core.prompts import ChatPromptTemplate
from langchain.callbacks.base import BaseCallbackHandler

# Callback Handler for Streaming
class StreamHandler(BaseCallbackHandler):
    def __init__(self, sql_container, output_container, spinner_placeholder):
        self.sql_container = sql_container
        self.output_container = output_container
        self.spinner_placeholder = spinner_placeholder
        self.sql_output = ""
        self.llm_output = ""

        # Add custom CSS for scrollable container and spinner
        st.markdown("""
        <style>
        #scrollable-output-container {
            height: 200px;
            overflow-y: auto;
            border: 1px solid #ccc;
            padding: 10px;
            white-space: pre-wrap;
            word-wrap: break-word;
            margin-bottom: 20px;
        }
        .custom-spinner {
            display: flex;
            align-items: center;
        }
        .custom-spinner .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            border-left: 4px solid #3498db;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            animation: spin 1s linear infinite;
            margin-right: 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        </style>
        """, unsafe_allow_html=True)

        st.markdown("""
        <script>
        function scrollToBottom(elementId) {
            var element = document.getElementById(elementId);
            element.scrollTop = element.scrollHeight;
        }
        </script>
        """, unsafe_allow_html=True)

    def on_agent_action(self, action, **kwargs):
        if action.tool == "sql_db_query":
            self.sql_output += action.tool_input + "\n"

            with results_placeholder.container():
                col1, col2 = st.columns([20, 35])
                with col1:
                    with st.container(height=600):
                        st.code(self.sql_output, language='sql')
                with col2:
                    with st.container(height=600):
                        st.markdown("Summarizing Insights ...")

            self.update_spinner("Summarizing Insights ...")

    def update_spinner(self, text):
        self.spinner_placeholder.markdown(f"""
        <div class="custom-spinner">
            <div class="spinner"></div>
            <span>{text}</span>
        </div>
        <br/> 
        """, unsafe_allow_html=True)
   
    def on_llm_new_token(self, token: str, **kwargs) -> None:
        # Clean up token: strip newline characters but preserve spaces within tokens
        token = token.strip("\n")
        #self.llm_output += token + " "

        # Check if the token should be concatenated to the previous word or separated by a space
        if self.llm_output and self.llm_output[-1].isalpha() and not token.startswith((" ", ".", ",", "!", "?", "'", "\"")):
            # Merge without adding a space if the token continues the previous word
            #self.llm_output += token + " "
            self.llm_output = self.llm_output.rstrip() + token
        else:
            # Ensure there is exactly one space if it's not a direct continuation
            if not self.llm_output.endswith(" "):
                self.llm_output += " "
            self.llm_output += token

        # Fix spaces and capitalization for SQL keywords specifically
        sql_keywords = ["SELECT", "ORDER BY", "FROM", "WHERE", "GROUP BY", "JOIN", "ON", "LIMIT"]
        for keyword in sql_keywords:
            # Remove spaces within SQL keywords
            self.llm_output = re.sub(rf'\b{" ".join(keyword)}\b', keyword, self.llm_output, flags=re.IGNORECASE)

        #Update the output container with the new text
        self.output_container.markdown(f"""
           <div id="scrollable-output-container">
               {self.llm_output}
           </div>
        """, unsafe_allow_html=True)

    def clear_output(self):
        """Clear the output container content."""
        self.output_container.empty()

# Override the SQLDatabase class to only include the desired tables
class FilteredSQLDatabase(SQLDatabase):
    def get_usable_table_names(self):
        return filtered_tables

# Extract SQL Query from Intermediate Steps
def extract_sql_query(intermediate_steps):
    for step in intermediate_steps:
        if isinstance(step, tuple) and len(step) == 2:
            action, _result = step
            if isinstance(action, dict) and action.get('tool') == 'sql_db_query':
                return action.get('tool_input', "No SQL query found")
    return "No SQL query found"

# Function to Create Bedrock LLM for Claude v3 Models
def create_bedrock_llm():
    bedrock_runtime = boto3.client(service_name="bedrock-runtime")
    llm = BedrockChat(
        model_id="anthropic.claude-3-5-sonnet-20240620-v1:0",
        client=bedrock_runtime,
        model_kwargs={
            "temperature": 0,
            "top_k": 250,
            "top_p": 1,
        },
        streaming=True
    )
    return llm

# Function to Get the Current Time
def get_current_time():
    return datetime.now()

# Function to Create Athena Engine
def create_athena_engine(aws_region, athena_workgroup, athena_query_result_location, db_name):
    athena_endpoint = f'athena.{aws_region}.amazonaws.com'
    athena_conn_string = (
        f"awsathena+rest://@{athena_endpoint}:443/{db_name}"
        f"?s3_staging_dir={athena_query_result_location}&work_group={athena_workgroup}"
    )
    athena_engine = create_engine(athena_conn_string, echo=True)
    return SQLDatabase(athena_engine)

# Function to Get Filtered Tables
def get_filtered_tables(db, desired_tables):
    all_tables = db.get_usable_table_names()
    return [table for table in all_tables if table in desired_tables]

# Function to Create SQL Agent
def create_agent(db, llm):
    sql_toolkit = SQLDatabaseToolkit(llm=llm, db=db)
    agent_kwargs = {
        "handle_parsing_errors": True,
        "handle_sql_errors": True
    }
    return create_sql_agent(
        llm=llm,
        toolkit=sql_toolkit,
        agent_executor_kwargs=agent_kwargs,
        agent_type=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
        verbose=False
    )

# Function to Store Results in DynamoDB
def store_in_dynamodb(user_name, start_time, end_time, elapsed_time, user_prompt, sql_query, output, original_user_question):
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table('tbl_market_basket_analysis')
    table.put_item(
        Item={
            'query_id': str(uuid.uuid4()),
            'user_name': user_name,
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat(),
            'elapsed_time': str(elapsed_time.total_seconds()),
            'user_prompt': str(user_prompt),
            'sql_query': str(sql_query),
            'output': str(output),
            'original_user_question': str(original_user_question)
        }
    )

# Initialization
st.set_page_config(page_title="Market Basket Analysis Chatbot", page_icon=":rocket:", layout='wide')
st.image('https://upload.wikimedia.org/wikipedia/commons/9/93/Amazon_Web_Services_Logo.svg', width=200)

# Display Header
col1, col2 = st.columns([30, 5])
with col1:
    st.header("Market Basket Analysis")
with col2:
    logout_button = st.button("Logout")

if logout_button:
    st.session_state["logged_in"] = False
    st.rerun()

st.write("-----")

region = boto3.session.Session().region_name

# Athena Configuration
athena_workgroup = 'primary'
athena_query_result_location = 's3://aws-athena-query-results-us-east-1-211125668933/bedrock1/'
db_name = 'db_market_basket_analysis'

# Filter Tables to Include Only Desired Tables
desired_tables = ["tbl_market_basket_analysis", "product_margin_and_sku_iceberg"]
db = create_athena_engine(region, athena_workgroup, athena_query_result_location, db_name)
filtered_tables = get_filtered_tables(db, desired_tables)
filtered_db = FilteredSQLDatabase(db._engine)

# Create LLM and Agent
llm = create_bedrock_llm()
agent = create_agent(filtered_db, llm)

#Prompt Template
prompt_template = ChatPromptTemplate.from_messages([
    ("system", """
    You are an expert in Amazon Athena.
    You have access to the live database to query.
    To answer this question, 
        you will first need to get the schema of the relevant tables to see what columns are available.
    Then query the relevant tables in the database to come up with Final Answer.
    Do not assume any values for the data.
    Use [sql_db_list_tables] to get a list of tables in the database.
    Use [sql_db_schema] to the schema for these tables.
    Use [sql_db_query_checker] to validate the SQL query.
    Execute the query using [sql_db_query] tool and observe the output.
    Always provide the explanation and assumptions that you have made to come up with the output.
    For forecasting questions:
    - There won't be any data available for the future dates. So, identify historical data trends.
    - Use appropriate methods to forecast future values based on historical data.
    - Clearly explain the forecasting methodology and results.
    """),
    ("human", "{context}"),
])

# Initialize Session State
if 'conversation' not in st.session_state:
    st.session_state.conversation = []

# User Input and Buttons
st.subheader("Ask Me Any Market Basket Analysis Question")
user_question = st.text_input("Enter your question:")

# Placeholders
col1, col2 = st.columns([8, 1])
with col1:
    submit_button = st.button("Submit")
with col2:
    timer_placeholder = st.empty()

spinner_placeholder = st.empty()
sql_placeholder = st.empty()
output_placeholder = st.empty()
results_placeholder = st.empty()

def main():
    global user_question
    if submit_button and st.session_state["logged_in"]:
        if user_question:
            original_user_question = user_question
            user_question = (
                user_question + 
                ". Based on the input prompt, please display all requested attributes " 
                "and provide a comprehensive and detailed response. Avoid giving brief or incomplete answers."
                " Always provide the explanation and assumptions that you have made to come up with the output."
                " Do not include technical details about how the answer was derived."
            )

            start_time = get_current_time()

            # Clear placeholders before processing
            sql_placeholder.empty()
            output_placeholder.empty()
            results_placeholder.empty()

            st.session_state.conversation.append({"role": "human", "content": user_question})

            # Maintain only the last 4 conversations
            if len(st.session_state.conversation) > 4:
                st.session_state.conversation = st.session_state.conversation[-4:]

            context = "\n".join([f"{msg['role']}: {msg['content']}" for msg in st.session_state.conversation])
            
            stream_handler = StreamHandler(sql_placeholder, output_placeholder, spinner_placeholder)
            with spinner_placeholder:
                with st.spinner("Generating the SQL ..."):
                    response = agent.invoke(
                        {"input": context},
                        {"callbacks": [stream_handler]}
                    )

            output = response['output']
            sql_query = extract_sql_query(response.get('intermediate_steps', []))

            if sql_query == "No SQL query found" and hasattr(stream_handler, 'sql_output'):
                sql_query = stream_handler.sql_output

            st.session_state.conversation.append({"role": "assistant", "content": output})

            # Display elapsed time
            elapsed_time = get_current_time() - start_time
            hours, remainder = divmod(elapsed_time.total_seconds(), 3600)
            minutes, seconds = divmod(remainder, 60)
            timer_placeholder.write(f"Time: {int(hours):02}:{int(minutes):02}:{int(seconds):02}")

            # Display SQL query and output
            with results_placeholder.container():
                col1, col2 = st.columns([20, 35])
                with col1:
                    with st.container(height=600):
                        st.code(sql_query, language='sql')
                with col2:
                    with st.container(height=600):
                        st.markdown(output)

            spinner_placeholder.empty()
            stream_handler.clear_output()

            # Store results in DynamoDB
            store_in_dynamodb(st.session_state["user_name"], start_time, get_current_time(), elapsed_time, user_question, sql_query, output, original_user_question)
        else:
            st.write("Please enter a question.")

if __name__ == "__main__":
    if st.session_state.get("logged_in"):
        main()
    else:
        st.error("Please login to use the application!")
