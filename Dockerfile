FROM orchardup/nginx
RUN apt-get update -qq && apt-get install rubygems -y
RUN gem install nanoc -v 3.6.6
ADD . /code
WORKDIR /code
RUN nanoc compile
ADD private/roms /var/www/projects/jsnes/roms
ADD private/server.crt /etc/nginx/ssl/
ADD private/server.key /etc/nginx/ssl/
RUN ln -s /etc/nginx/sites-available/default-ssl /etc/nginx/sites-enabled/default-ssl
CMD 'nginx'
