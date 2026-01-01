FROM --platform=linux/amd64 public.ecr.aws/docker/library/python:3.12.2-slim-bullseye

# Install Rust and Cargo
RUN apt-get update && \
    apt-get install -y curl build-essential && \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
    export PATH="$HOME/.cargo/bin:$PATH"

WORKDIR /app
COPY ./ /app/

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install -r requirements.txt --no-cache-dir --verbose

EXPOSE 8501
HEALTHCHECK --interval=600s --timeout=2s --retries=12 \
    CMD ["curl", "-f", "http://localhost:8501/"]

# Run the application
ENTRYPOINT ["streamlit", "run", "login.py", "--server.headless", "true", "--browser.serverAddress='0.0.0.0'", "--browser.gatherUsageStats", "false"]

USER 1001
