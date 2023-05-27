import {
  getBlockNumber,
  useAddress,
  useContract,
  useContractEvents,
  useContractRead,
  useContractWrite,
  useSDK,
  useSigner,
} from "@thirdweb-dev/react";
import mintNFTABI from "../contracts/MintNFT.json";
import forwarderABI from "../contracts/Fowarder.json";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NFT } from "types/NFT";
import axios from "axios";
import { ipfs2http } from "utils/ipfs2http";
import { Event } from "types/Event";
import { signMetaTxRequest } from "utils/signer";

export const useMintNFTContract = () => {
  const {
    contract: mintNFTContract,
    isLoading,
    error,
  } = useContract(
    process.env.NEXT_PUBLIC_CONTRACT_MINT_NFT_MANAGER!,
    mintNFTABI.abi
  );

  return { mintNFTContract, isLoading, error };
};

export const useForwarderContract = () => {
  const {
    contract: forwarderContract,
    isLoading,
    error,
  } = useContract(process.env.NEXT_PUBLIC_FORWARDER_ADDRESS!, forwarderABI.abi);

  return { forwarderContract, isLoading, error };
};

export const useGetTokenURI = (id: number | null) => {
  const { mintNFTContract } = useMintNFTContract();
  const { data } = useContractRead(mintNFTContract, "tokenURI", [id]);

  return data;
};

export const useGetOwnedNftIdsByAddress = (address?: string) => {
  const { mintNFTContract, isLoading } = useMintNFTContract();
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    const fetch = async () => {
      if (!address || isLoading) return;
      const _ids: number[] = [];
      const balance = await mintNFTContract?.call("balanceOf", [address]);
      for (let index = 0; index < balance.toNumber(); index++) {
        const tokenId = await mintNFTContract?.call("tokenOfOwnerByIndex", [
          address,
          index,
        ]);
        _ids.push(tokenId.toNumber());
      }
      setIds(_ids);
    };
    fetch();
  }, [address, isLoading]);

  // const { mintNFTContract } = useMintNFTContract();

  // const { data: sentLogs, error } = useContractEvents(
  //   mintNFTContract,
  //   "Transfer",
  //   {
  //     queryFilter: {
  //       filters: {
  //         from: address,
  //         to: null,
  //       },
  //     },
  //   }
  // );

  // const { data: receiveLogs } = useContractEvents(mintNFTContract, "Transfer", {
  //   queryFilter: {
  //     filters: {
  //       from: null,
  //       to: address,
  //     },
  //   },
  // });

  // const logs = useMemo(() => {
  //   if (sentLogs && receiveLogs) {
  //     return [...sentLogs, ...receiveLogs].sort(
  //       (a, b) =>
  //         a.transaction.blockNumber - b.transaction.blockNumber ||
  //         a.transaction.transactionIndex - b.transaction.transactionIndex
  //     );
  //   } else if (sentLogs) {
  //     return sentLogs;
  //   } else if (receiveLogs) {
  //     return receiveLogs;
  //   } else {
  //     return [];
  //   }
  // }, [sentLogs, receiveLogs]);

  // const ids = useMemo(() => {
  //   if (!address) return;
  //   const isAddressesEqual = (address1: string, address2: string) => {
  //     return address1.toLowerCase() === address2.toLowerCase();
  //   };
  //   const owned = new Set<number>();

  //   for (const log of logs) {
  //     if (log.data) {
  //       const { from, to, tokenId } = log.data;

  //       if (isAddressesEqual(to, address)) {
  //         owned.add(Number(tokenId));
  //       } else if (isAddressesEqual(from, address)) {
  //         owned.delete(Number(tokenId));
  //       }
  //     }
  //   }

  //   return Array.from(owned);
  // }, [logs]);

  return ids;
};

export const useGetOwnedNFTByAddress = (address?: string) => {
  const { mintNFTContract } = useMintNFTContract();
  const ids = useGetOwnedNftIdsByAddress(address);
  const [nfts, setNfts] = useState<NFT.Metadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setNfts([]);
    if (!ids) return;

    const fetch = async () => {
      const _nfts: any[] = [];
      for (const id of ids) {
        try {
          const tokenURI = await mintNFTContract?.call("tokenURI", [id]);
          const { data: metaData } = await axios.get(ipfs2http(tokenURI));
          _nfts.push({ ...metaData, tokenId: id });
        } catch (error) {
          console.log(error);
          continue;
        }
      }
      setNfts(_nfts);
      setIsLoading(false);
    };

    fetch();
  }, [ids, address]);

  return { nfts, isLoading };
};

export const useSortNFTsByGroup = (_nfts: NFT.Metadata[]) => {
  const nfts = useMemo(() => {
    return _nfts.reduce<Record<number, NFT.Metadata[]>>((nfts, current) => {
      const { traits } = current;
      nfts[Number(traits.EventGroupId)] =
        nfts[Number(traits.EventGroupId)] ?? [];
      nfts[Number(traits.EventGroupId)].push(current);
      return nfts;
    }, {});
  }, [_nfts]);

  return nfts;
};

export const useMintParticipateNFT = (
  event: Event.EventRecord,
  address: string,
  useMTX: boolean = false
) => {
  const { mintNFTContract } = useMintNFTContract();
  const { forwarderContract } = useForwarderContract();
  const signer = useSigner();
  const sdk = useSDK();
  const {
    mutateAsync,
    isLoading: isMinting,
    error: mintError,
    status: mintStatus,
  } = useContractWrite(mintNFTContract, "mintParticipateNFT");
  const [mtxStatus, setMtxStatus] = useState<{
    error: any;
    isLoading: boolean;
    status: "error" | "idle" | "loading" | "success";
  }>({
    error: null,
    isLoading: false,
    status: "idle",
  });
  const [fromBlock, setFromBlock] = useState<number>();
  const { data } = useContractEvents(mintNFTContract, "Transfer", {
    queryFilter: {
      filters: {
        from: null,
        to: address,
        fromBlock: fromBlock,
      },
    },
    subscribe: true,
  });

  useEffect(() => {
    const fetch = async () => {
      const chainId = process.env.NEXT_PUBLIC_CHAIN_ID!;
      const number = await getBlockNumber({
        network:
          chainId === "80001"
            ? "mumbai"
            : chainId === "137"
            ? "polygon"
            : "localhost",
      });
      setFromBlock(number);
    };
    fetch();
  }, []);

  const error: any = useMemo(() => {
    return useMTX ? mtxStatus.error : mintError;
  }, [mintError, mtxStatus]);
  const isLoading = useMemo(() => {
    return useMTX ? mtxStatus.isLoading : isMinting;
  }, [isMinting, mtxStatus]);
  const status = useMemo(() => {
    return useMTX ? mtxStatus.status : mintStatus;
  }, [mintStatus, mtxStatus]);

  const [mintedNFTId, setMintedNFTId] = useState<number | null>(null);
  const [mintedNFT, setMintedNFT] = useState<NFT.Metadata | null>(null);
  const mintedTokenURI = useGetTokenURI(mintedNFTId);
  useEffect(() => {
    const fetch = async () => {
      if (!mintedTokenURI) return;
      try {
        const { data } = await axios.get(ipfs2http(mintedTokenURI));
        setMintedNFT(data);
      } catch (_) {
        return;
      }
    };
    fetch();
  }, [mintedTokenURI]);

  useEffect(() => {
    if (status !== "success" || !data || data.length < 1) return;
    console.log(data);
    const tokenId = data[data.length - 1].data?.tokenId.toNumber();
    setMintedNFTId(tokenId);
  }, [data, status]);

  const checkCanMint = useCallback(
    async (eventId: number, secretPhrase: string) => {
      if (!mintNFTContract) return;
      try {
        await mintNFTContract.call("canMint", [eventId, secretPhrase]);
        return;
      } catch (error) {
        throw error;
      }
    },
    [mintNFTContract]
  );

  const mint = useCallback(
    async (secretPhrase: string) => {
      if (!event || !event.eventRecordId || !event.groupId) return;
      try {
        await mutateAsync({
          args: [event.groupId, event.eventRecordId, secretPhrase],
        });
      } catch (_) {}
    },
    [event, mutateAsync]
  );

  const mintMTX = useCallback(
    async (secretPhrase: string) => {
      if (!event || !event.eventRecordId || !event.groupId || !sdk) return;
      setMtxStatus({ isLoading: true, status: "loading", error: null });
      try {
        await checkCanMint(event.eventRecordId.toNumber(), secretPhrase);
        const to = mintNFTContract?.getAddress();
        const from = address;
        const data = mintNFTContract?.encoder.encode("mintParticipateNFT", [
          event?.groupId.toNumber(),
          event?.eventRecordId.toNumber(),
          secretPhrase,
        ]);
        const request = await signMetaTxRequest(sdk.wallet, forwarderContract, {
          from,
          to,
          data,
        });
        const { data: response } = await axios.post("/api/autotask", {
          request: request.request,
          signature: request.signature.signature,
        });
        setMtxStatus({ ...mtxStatus, status: "success", isLoading: false });
        return response;
      } catch (error) {
        setMtxStatus({ ...mtxStatus, error, status: "error" });
      }
    },
    [event, forwarderContract, signer]
  );

  return { mint, mintMTX, isLoading, error, status, mintedNFT };
};