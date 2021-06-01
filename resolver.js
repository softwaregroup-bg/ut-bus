// fixed https://www.npmjs.com/package/mdns-resolver
const MDNS = require('multicast-dns');
const util = require('util');
const os = require('os');

module.exports = util.promisify((hostname, rrtype, tls, callback) => {
    const localhost = tls && [].concat(...Object.values(os.networkInterfaces()))
        .map(({address}) => address)
        .filter(Boolean)
        .reduce((prev, address) => [...prev, address], ['0.0.0.0']);

    const mdns = MDNS();
    if (hostname.charAt(hostname.length - 1) === '.') {
        hostname = hostname.substring(0, hostname.length - 1);
    }
    const timeoutHandler = setTimeout(() => {
        clearInterval(retryHandler);
        mdns.removeListener('response', responseHandler);
        mdns.destroy();
        callback(new Error(`Could not resolve ${hostname} - Query Timed Out`));
    }, 3000);
    const retryHandler = setInterval(() => {
        mdns.query(hostname, rrtype);
    }, 500);
    const responseHandler = (response, info) => {
        const answer = response.answers.find(x => x.name === hostname && x.type === rrtype);
        if (answer) {
            clearTimeout(timeoutHandler);
            clearInterval(retryHandler);
            mdns.removeListener('response', responseHandler);
            mdns.destroy();
            if (rrtype === 'SRV' && answer.data) {
                if (tls) {
                    if (localhost.includes(answer.data.target)) answer.data.target = 'localhost';
                } else {
                    if (answer.data.target === '0.0.0.0') answer.data.target = info.address;
                }
            }
            callback(null, answer.data);
        }
    };
    mdns.on('response', responseHandler);
    mdns.query(hostname, rrtype);
});
