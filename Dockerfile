FROM node:8
WORKDIR snyk-go-plugin 
COPY . ./
ENTRYPOINT bash