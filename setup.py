from setuptools import setup, find_packages
  
setup(
    name='toddleglow',
    version='0.0.1',
    description='A Toddler Clock that will change colors based on user specified time intervals. This can be used in combination with Rasbpian and a PiGlow (made by pimoroni, https://shop.pimoroni.com/products/piglow). Alternatively you could use a screen/monitor from a laptop or old cellphone',
    author='Dan Farnsworth',
    author_email='absltkaos@gmail.com',
    install_requires=[
        'arrow',
        'flask',
        'gevent',
        'geventwebsocket'
   ]
)
