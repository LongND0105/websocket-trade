import {WebSocket} from 'ws';
import * as readline from 'readline';
import chalk from 'chalk';

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction, 
} from '@solana/web3.js';

import { createFreezeAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

const BITQUERY_WS_URL  = "wss://streaming.bitquery.io/eap";
const BITQUERY_API_KEY = "ory_at_KFL_aph8quwP8gKF_C9UhSxTiAp0x_eLIVCVvDMiOs0.PAg0hWwuil7wv-EyOASBGUvjMlG64i7w5mpYuNEoVOc";
const MAINNET_ENDPOINT = "https://api.devnet.solana.com";
const DEVNET_ENDPOINT  = "https://api.devnet.solana.com";

var bitqueryConnection: WebSocket; 
var solanaConnection: Connection;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

var payer: any;
var freezeAuthority: any;
var tokenMint: any;
var tokenMintStr: string;

function showMenu() {
  console.log(chalk.bgGreenBright("\nA simple tool for freeze token account"));
  console.log(chalk.bgBlue("1. Add a privateKey for sign__________"));
  console.log(chalk.bgCyan("2. Add a privateKey for freeze________"));
  console.log(chalk.bgBlue("3. Add a token address for tracking___"));
  console.log(chalk.bgCyan("4. Going to freeze token account______"));
  console.log(chalk.bgBlue("5. Exit_______________________________"));
}

function showQuestion() {
  rl.question(chalk.yellow("👉 Select one [1-5]: "), handleChoice);
}

function exitTool() {
  rl.close();
}

function addKeyForSignHandler() {
  rl.question(chalk.yellow("👉 Paste a private key: "), (privateKey) => {
    try {
      var payerSecretKey = Buffer.from(bs58.decode(privateKey));
      payer = Keypair.fromSecretKey(new Uint8Array(payerSecretKey));
      freezeAuthority = Keypair.fromSecretKey(new Uint8Array(payerSecretKey));
      console.log(chalk.green('=> Success'));
    } 
    catch (err) {
      console.error(chalk.red(err));
    }

    showMenu();
    showQuestion();
  });
}

function addKeyForFreezeHandler() {
  rl.question("👉 Paste a private key: ", (privateKey) => {
    try {
      console.log(`=> ${privateKey}`);
      var freezeAuthoritySecretKey = Buffer.from(bs58.decode(privateKey));
      freezeAuthority = Keypair.fromSecretKey(new Uint8Array(freezeAuthoritySecretKey));
      console.log(chalk.green('=> Success'));
    } 
    catch (err) {
      console.error(chalk.red(err));
    }

    showMenu();
    showQuestion();
  });
}

function addTokenMintHandler() {
  rl.question("👉 Paste a token address: ", (tokenAddress) => {
    try {
      tokenMint = new PublicKey(tokenAddress);
      tokenMintStr = tokenAddress;
      console.log(chalk.green('=> Success'));
    } 
    catch (err) {
      console.error(chalk.red(err));
    }
    
    showMenu();
    showQuestion();
  });
}

async function freezeTokenAccountHandler() {
  try {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    console.log(chalk.gray('Press q key to exit listening websocket mode'));

    process.stdin.on('keypress', (str, key) => {
      if (str && str.toLowerCase() === 'q') {
        bitqueryConnection.close();
        console.log(chalk.red("\nDisconnected from Bitquery."));
        setTimeout(showMenu, 3000);
        setTimeout(showQuestion, 1000);
      } 
    });
    
    solanaConnection = new Connection(DEVNET_ENDPOINT, 'confirmed');

    bitqueryConnection = new WebSocket(
      `wss://streaming.bitquery.io/eap?token=${BITQUERY_API_KEY}`,
      ["graphql-ws"],
      {
        headers: {
          "Sec-WebSocket-Protocol": "graphql-ws",
          "Content-Type": "application/json",
        },
      }
    );

    bitqueryConnection.on("open", () => {
      console.log("Connected to Bitquery.");
    
      // Send initialization message
      const initMessage = JSON.stringify({ type: "connection_init" });
      bitqueryConnection.send(initMessage);
      
      // After initialization, send the actual subscription message
      setTimeout(() => {
        const message = JSON.stringify({
          type: "start",
          id: "1",
          payload: {
            query: 
            `
            subscription MyQuery {
              Solana {
                DEXTradeByTokens(
                  where: {Trade: {Currency: {MintAddress: {is: "${tokenMintStr}"}}, Side: {Currency: {MintAddress: {is: "So11111111111111111111111111111111111111112"}}}, Dex: {ProgramAddress: {is: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"}}}, Transaction: {Result: {Success: true}}}
                ) {
                  Block {
                    Time
                  }
                  Trade {
                    Currency {
                      Symbol
                    }
                    Amount
                    Side {
                      Currency {
                        Symbol
                      }
                      Amount
                      Type
                    }
                  }
                  Transaction {
                    Maker: Signer
                  }
                }
              }
            }
            `
          },
        });
    
        bitqueryConnection.send(message);
      }, 1000);
    });
    
    
    bitqueryConnection.on("message", async (data: ArrayBuffer | Buffer) => {
      try {
        const strData: string = Buffer.from(data).toString();
        const response: BitqueryResponse = JSON.parse(strData);
      
        if (response.type === "data" && response.payload?.data) {
          const trade = response.payload.data.Solana.DEXTradeByTokens[0];
          
          console.log(chalk.gray("Received data from Bitquery:"));
          console.log(chalk.gray(`\t\tTime:         ${trade.Block.Time}`));
          console.log(chalk.gray(`\t\tTrade Amount: ${trade.Trade.Amount} ${trade.Trade.Currency.Symbol}`));
          console.log(chalk.gray(`\t\tSide:         ${trade.Trade.Side.Type}`));
          console.log(chalk.gray(`\t\tSide Amount:  ${trade.Trade.Side.Amount} ${trade.Trade.Side.Currency.Symbol}`));
          console.log(chalk.gray(`\t\tMaker:        ${trade.Transaction.Maker}`));

          var wallet = new PublicKey(trade.Transaction.Maker);

          const tokenAcc = await solanaConnection.getParsedTokenAccountsByOwner(wallet, {mint: tokenMint}, 'confirmed');

          tokenAcc.value.forEach(async (item, _) => {
            const accountInfo = item.account;
            const parsedInfo = accountInfo.data.parsed.info;

            var tokenAccount = new PublicKey(item.pubkey.toBase58());
            var state = parsedInfo.state;

            console.log(chalk.blue(`Token account: ${item.pubkey.toBase58()}`));
            console.log(chalk.blue(`State: ${parsedInfo.state}`));
            
            if (state != "frozen") {
              try {
                console.log(chalk.green('\nToken have not frozen yet'));
                var signature = await freezeTokenAccount(solanaConnection, payer as Keypair, tokenMint, tokenAccount, freezeAuthority);
                console.log(chalk.blue('\nSignature:', signature));
                console.log('\nThe token account has been successfully frozen');
              } 
              catch (error) {
                console.error(chalk.red('\nFailed to freeze token account with \n', error));
              }
            } else {
              console.error(chalk.red('\nToken has been frozen.'));
            }
          });
        }
      }
      catch (err) {
        console.error(chalk.red(err));
      };
    });
    
    bitqueryConnection.on("close", () => {
      console.log(chalk.red("Disconnected from Bitquery."));
    });

    bitqueryConnection.on("error", (error) => {
      console.error("WebSocket Error:", error);
    });
  }
  catch (err) {
    console.error(chalk.red(err));
  };
}

async function freezeTokenAccount(
  connection: Connection,
  payer: Keypair,
  tokenMint: PublicKey,
  tokenAccountToFreeze: PublicKey,
  freezeAuthority: Keypair
): Promise<any> {
  // Create a new transaction
  let transaction = new Transaction();

  // Add a freezeAccount instruction into transaction
  transaction.add(
    createFreezeAccountInstruction(
      tokenAccountToFreeze,
      tokenMint,
      freezeAuthority.publicKey,
      []
    )
  );

  // Send and wait confirm transaction
  var signature = await sendAndConfirmTransaction(connection, transaction, [payer, freezeAuthority]);
  
  return signature as string;
}

function handleChoice(choice: string) {
  switch (choice) {
    case '1':
      addKeyForSignHandler();
      break;

    case '2':
      addKeyForFreezeHandler();
      break;

    case '3':
      addTokenMintHandler();
      break;

    case '4':
      freezeTokenAccountHandler();
      break;

    case '5':
      console.log("Thank you!");
      exitTool();
      break;

    default:
      console.log("Invalid");
      showMenu();
      showQuestion();
  }
}

interface Trade {
  Amount: string;
  Currency: {
    Symbol: string;
  };
  Side: {
    Amount: string;
    Currency: {
      Symbol: string;
    };
    Type: string;
  };
}

interface DEXTrade {
  Block: {
    Time: string;
  };
  Trade: Trade;
  Transaction: {
    Maker: string;
  };
}

interface SolanaData {
  DEXTradeByTokens: DEXTrade[];
}

interface BitqueryResponseData {
  Solana: SolanaData;
}

interface BitqueryResponse {
  payload: {
    data: BitqueryResponseData;
  };
  id: string;
  type: string;
}

function main() {
  showMenu();
  showQuestion();
}

main();