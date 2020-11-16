// fixed https://www.npmjs.com/package/mdns-resolver
const MDNS = require('multicast-dns');
const util = require('util');

module.exports = util.promisify((hostname, rrtype, callback) => {
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
            if (rrtype === 'SRV' && answer.data && answer.data.target === '0.0.0.0') answer.data.target = info.address;
            callback(null, answer.data);
        }
    };
    mdns.on('response', responseHandler);
    mdns.query(hostname, rrtype);
});
