type CardProps = {
    title: string;
    count: string;
    stat: string;
};

const Card = ({ title, count, stat }: CardProps) => {
    return (
        <div className="flex flex-col gap-2 border rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="text-4xl font-bold">{count}</p>
            <p className="text-sm"><span className="font-semibold">+{stat}</span> increase from last month</p>
        </div>
    )
}

export default Card;