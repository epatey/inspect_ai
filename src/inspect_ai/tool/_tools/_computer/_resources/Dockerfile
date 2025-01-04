FROM docker.io/ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBIAN_PRIORITY=high

RUN apt-get update && \
    apt-get -y upgrade && \
    apt-get -y install \
    # UI Requirements
    xvfb \
    xterm \
    xdotool \
    scrot \
    imagemagick \
    sudo \
    mutter \
    x11vnc \
    # Python reqs
    python3 \
    python3-pip \
    # Network tools
    net-tools \
    netcat \
    # PPA req
    software-properties-common && \
    # Add PPA for Firefox
    sudo add-apt-repository ppa:mozillateam/ppa && \
    # Userland apps
    sudo apt-get install -y --no-install-recommends \
    libreoffice \
    firefox-esr \
    x11-apps \
    xpdf \
    gedit \
    xpaint \
    tint2 \
    galculator \
    pcmanfm \
    unzip && \
    apt-get clean

# setup user
ENV USERNAME=computeruse
ENV HOME=/home/$USERNAME
RUN useradd -m -s /bin/bash -d $HOME $USERNAME
RUN echo "${USERNAME} ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
USER computeruse
WORKDIR $HOME

# only reinstall if requirements.txt changes
COPY computer_tool/requirements.txt /opt/computer_tool/requirements.txt
RUN cd /opt/computer_tool && pip3 install --no-cache-dir -r requirements.txt

COPY --chown=$USERNAME:$USERNAME image_home_dir/ $HOME
COPY computer_tool/ /opt/computer_tool

ARG DISPLAY_NUM=1
ARG HEIGHT=768
ARG WIDTH=1024
ENV DISPLAY_NUM=$DISPLAY_NUM
ENV HEIGHT=$HEIGHT
ENV WIDTH=$WIDTH

ENTRYPOINT [ "./entrypoint.sh" ]
