FROM eric-base


ENV DEBIAN_FRONTEND=noninteractive
ENV DEBIAN_PRIORITY=high

USER root
RUN apt-get update && \
    apt-get install -y  \
      python3-tk \
      python3-dev \
      python3-pyatspi \
      at-spi2-core \
      gimp \
      # Some requirements require git 
      git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# osworld expects a user of "user". This happens to be the same name that the base image setup
USER user

# TODO: Should this just go into /opt rather than HOME?
COPY osworld_server $HOME/osworld_server

RUN pip install -r osworld_server/requirements.txt

# osworld's control channel via flask server app
# EXPOSE 5000

CMD ["bash", "/home/user/osworld_server/start.sh"]

USER root
RUN apt-get update && \
    apt-get install -y gimp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Add a gimp icon to the task bar
RUN echo 'launcher_item_app = /home/user/.config/tint2/applications/gimp.desktop' >> $HOME/.config/tint2/tint2rc
RUN mkdir -p $HOME/.config/GIMP/2.10 && echo '(color-profile-policy convert)' >> $HOME/.config/GIMP/2.10/gimprc


COPY _hack_setup.sh $HOME/


# There may be a better way, but in order to hit the ENTRYPOINT properly, we need to
# go back to its expected state
USER user
WORKDIR $HOME
