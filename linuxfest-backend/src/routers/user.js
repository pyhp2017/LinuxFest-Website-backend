const express = require('express');
const User = require('../models/User');
const auth = require('../express_middlewares/userAuth');

const { baseURL } = require('../utils/consts');
const { checkPermission, sendWelcomeEmail, sendForgetPasswordEmail } = require('../utils/utils')
const { authenticateAdmin } = require('../express_middlewares/adminAuth')


const router = new express.Router();

async function createUser(req, res) {
    const user = new User(req.body);

    try {
        await user.save();

        const token = await user.generateAuthToken();

        sendWelcomeEmail(user);
        res.status(201).send({ user, token });
    } catch (error) {
        res.status(400).send(error);
    }
}

router.post('/', async (req, res) => {
    await createUser(req, res);
});

router.post('/ac', authenticateAdmin, async (req, res) => {
    if (!checkPermission(req.admin, "addUser", res)) {
        return;
    }
    await createUser(req, res);
});

router.post('/login', async (req, res) => {
    try {
        const user = await User.findByCredentials(req.body.email, req.body.password);
        const token = await user.generateAuthToken();
        res.send({ user, token });
    } catch (error) {
        console.log(error);

        res.status(400).send(error);
    }
});

router.post('/me/logout', auth, async (req, res) => {
    try {
        req.user.tokens = req.user.tokens.filter((token) => token.token !== req.token);
        await req.user.save();

        res.send();
    } catch (error) {
        res.status(500).send();
    }
});

router.post('/me/logoutAll', auth, async (req, res) => {
    try {
        req.user.tokens = [];

        await req.user.save();
        res.send();
    } catch (error) {
        res.status(500).send();
    }
});

router.get('/', authenticateAdmin, async (req, res) => {
    if (!checkPermission(req.admin, "getUser", res)) {
        return;
    }
    try {
        const users = await User.find();
        res.send(users);
    } catch (err) {
        res.status(500).send(err);
    }
});

router.get('/me', auth, async (req, res) => {
    res.send(req.user);
});

router.get('/forget', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.user.email });

        if (!user) {
            res.status(404).send();
            return;
        }
        const forgotToken = await user.generateForgotToken(req.body.user.email);

        sendForgetPasswordEmail(user, forgotToken);

        res.status(200).send();

    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

async function userPatch(user, req, res, isAdmin) {
    const updates = Object.keys(req.body);
    let allowedUpdates = ['firstName', 'lastName', 'email', 'password', 'age', 'phoneNumber'];
    if (isAdmin) {
        allowedUpdates += 'studentNumber';
    }
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update));

    if (!isValidOperation) {
        return res.status(400).send({ error: 'invalid updates' });
    }
    try {
        updates.forEach((update) => user[update] = req.body[update]);

        await user.save();

        res.send(user);
    } catch (error) {
        res.status(400).send(error);
    }
}

router.patch('/me', auth, async (req, res) => {
    await userPatch(req.user, req, res, false);
});

router.patch('/:id', authenticateAdmin, async (req, res) => {
    if (!checkPermission(req.admin, "editUser", res)) {
        res.status(401).send();
        return;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404).send();
    }
    await userPatch(user, req, res, true);
});

router.patch('/forget/:token', async (req, res) => {
    try {
        const user = await User.findOne({ 'forgotTokens.forgotToken': req.params.token });
        if (!user) {
            res.status(404).send();
            return;
        }
        user.password = req.body.password

        await user.save();
        res.status(200).send({ user });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

async function userDelete(user, req, res) {
    try {
        await User.deleteOne(user);
        await user.save();

        res.send(user);
    } catch (error) {
        res.status(500).send();
    }
}

router.delete('/me', auth, async (req, res) => {
    await userDelete(req.user, req, res);
});

router.delete('/:id', authenticateAdmin, async (req, res) => {
    if (!checkPermission(req.admin, "deleteUser", res)) {
        res.status(401).send();
        return;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404).send();
    }
    await userDelete(user, req, res);
});


async function initPayment(user, workshop) {
    const rand = Math.floor(Math.random() * 252097803149);
    const orderId = parseInt(user._id, 16) % rand;
    user.orderIDs = user.orderIDs.concat({ workshopId: workshop._id, idNumber: orderId });
    await user.save();
    const sign = process.env.TERMINAL_ID + ";" + orderId.toLocaleString('fullwide', { useGrouping: false }) + ";" + workshop.price.toLocaleString('fullwide', { useGrouping: false });

    console.log("'" + sign + "'");

    const SignData = CryptoJS.TripleDES.encrypt(sign, process.env.TERMINAL_KEY, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    }).toString();
    console.log(SignData);

    let data = {
        MerchantId: process.env.MERCHANT_ID,
        TerminalId: process.env.TERMINAL_ID,
        Amount: workshop.price,
        OrderId: orderId,
        LocalDateTime: new Date(),
        ReturnUrl: "test.test.ir",
        SignData: SignData,
        PaymentIdentity: process.env.PAYMENT_IDENTITY
    }

    console.log(data);


    const response = await axios.post(initPaymentUrl, data);
    console.log(response.data);
    // return "done";
    return response;
}

module.exports = router;