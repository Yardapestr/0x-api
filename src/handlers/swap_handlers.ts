import { SwapQuoterError } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';
import * as express from 'express';
import * as HttpStatus from 'http-status-codes';

import { CHAIN_ID } from '../config';
import { DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE, ETH_SYMBOL } from '../constants';
import { InternalServerError, RevertAPIError, ValidationError, ValidationErrorCodes } from '../errors';
import { logger } from '../logger';
import { isAPIError, isRevertError } from '../middleware/error_handling';
import { SwapService } from '../services/swap_service';
import { TokenMetadatasForChains } from '../token_metadatas_for_networks';
import { GetSwapQuoteRequestParams } from '../types';
import { findTokenAddress } from '../utils/token_metadata_utils';
export class SwapHandlers {
    private readonly _swapService: SwapService;
    constructor(swapService: SwapService) {
        this._swapService = swapService;
    }
    public async getSwapQuoteAsync(req: express.Request, res: express.Response): Promise<void> {
        // parse query params
        const {
            sellToken,
            buyToken,
            sellAmount,
            buyAmount,
            takerAddress,
            slippagePercentage,
            gasPrice,
        } = parseGetSwapQuoteRequestParams(req);
        const isETHSell = sellToken === ETH_SYMBOL;
        const sellTokenAddress = findTokenAddress(sellToken, CHAIN_ID);
        const buyTokenAddress = findTokenAddress(buyToken, CHAIN_ID);
        try {
            const swapQuote = await this._swapService.calculateSwapQuoteAsync({
                buyTokenAddress,
                sellTokenAddress,
                buyAmount,
                sellAmount,
                from: takerAddress,
                isETHSell,
                slippagePercentage,
                gasPrice,
            });
            res.status(HttpStatus.OK).send(swapQuote);
        } catch (e) {
            // If this is already a transformed error then just re-throw
            if (isAPIError(e)) {
                throw e;
            }
            // Wrap a Revert error as an API revert error
            if (isRevertError(e)) {
                throw new RevertAPIError(e);
            }
            const errorMessage: string = e.message;
            // TODO AssetSwapper can throw raw Errors or InsufficientAssetLiquidityError
            if (errorMessage.startsWith(SwapQuoterError.InsufficientAssetLiquidity)) {
                throw new ValidationError([
                    {
                        field: buyAmount ? 'buyAmount' : 'sellAmount',
                        code: ValidationErrorCodes.ValueOutOfRange,
                        reason: e.message,
                    },
                ]);
            }
            if (errorMessage.startsWith(SwapQuoterError.AssetUnavailable)) {
                throw new ValidationError([
                    {
                        field: 'token',
                        code: ValidationErrorCodes.ValueOutOfRange,
                        reason: e.message,
                    },
                ]);
            }
            logger.info('Uncaught error', e);
            throw new InternalServerError(e.message);
        }
    }
    // tslint:disable-next-line:prefer-function-over-method
    public async getSwapTokensAsync(_req: express.Request, res: express.Response): Promise<void> {
        const tokens = TokenMetadatasForChains.map(tm => ({
            symbol: tm.symbol,
            address: tm.tokenAddresses[CHAIN_ID],
        }));
        res.status(HttpStatus.OK).send(tokens);
    }
}

const parseGetSwapQuoteRequestParams = (req: express.Request): GetSwapQuoteRequestParams => {
    const takerAddress = req.query.takerAddress;
    const sellToken = req.query.sellToken;
    const buyToken = req.query.buyToken;
    const sellAmount = req.query.sellAmount === undefined ? undefined : new BigNumber(req.query.sellAmount);
    const buyAmount = req.query.buyAmount === undefined ? undefined : new BigNumber(req.query.buyAmount);
    const gasPrice = req.query.gasPrice === undefined ? undefined : new BigNumber(req.query.gasPrice);
    const slippagePercentage = Number.parseFloat(req.query.slippagePercentage || DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE);
    return { takerAddress, sellToken, buyToken, sellAmount, buyAmount, slippagePercentage, gasPrice };
};
